use std::collections::BTreeMap;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
type Tree = BTreeMap<PathBuf, Vec<u8>>;
const GATES: &[(&str, &[&str])] = &[
    ("format", &["fmt", "--all", "--", "--check"]),
    (
        "compile",
        &[
            "check",
            "--locked",
            "--all-targets",
            "--message-format=json",
        ],
    ),
    (
        "clippy",
        &[
            "clippy",
            "--locked",
            "--all-targets",
            "--message-format=json",
            "--",
            "-D",
            "warnings",
        ],
    ),
    ("tests", &["test", "--locked", "--all-targets"]),
    ("doctests", &["test", "--locked"]),
];

struct Lock(PathBuf);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn snapshot(dir: &Path) -> Result<Tree> {
    fn visit(root: &Path, dir: &Path, out: &mut Tree) -> Result<()> {
        for item in fs::read_dir(dir)? {
            let item = item?;
            let name = item.file_name();
            let name = name.to_string_lossy();
            if matches!(
                name.as_ref(),
                "target" | ".git" | ".rust-loop" | "node_modules"
            ) || name == ".env"
                || name.starts_with(".env.")
            {
                continue;
            }
            let path = item.path();
            let kind = item.file_type()?;
            if kind.is_symlink() {
                return Err(format!("Symlink unsupported: {}", path.display()).into());
            }
            if kind.is_dir() {
                visit(root, &path, out)?;
            } else if kind.is_file() {
                if item.metadata()?.len() > 2_000_000 {
                    return Err(format!("File exceeds 2MB: {}", path.display()).into());
                }
                out.insert(path.strip_prefix(root)?.to_owned(), fs::read(path)?);
            } else {
                return Err("Special files are unsupported".into());
            }
        }
        Ok(())
    }
    let mut tree = Tree::new();
    visit(dir, dir, &mut tree)?;
    if tree.values().map(Vec::len).sum::<usize>() > 20_000_000 {
        return Err("Project snapshot exceeds 20MB".into());
    }
    Ok(tree)
}

fn materialize(tree: &Tree, dest: &Path) -> Result<()> {
    for (rel, bytes) in tree {
        let path = dest.join(rel);
        fs::create_dir_all(path.parent().ok_or("Missing parent")?)?;
        fs::write(path, bytes)?;
    }
    Ok(())
}

fn tail(path: &Path, max: u64) -> Result<String> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(max)))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn execute(mut cmd: Command, dir: &Path, log: &Path, secs: u64) -> Result<bool> {
    let output = File::create(log)?;
    cmd.current_dir(dir)
        .stdin(Stdio::null())
        .stdout(output.try_clone()?)
        .stderr(output);
    cmd.process_group(0);
    let mut child = cmd.spawn()?;
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status.success());
        }
        if start.elapsed() >= Duration::from_secs(secs) {
            // Kill the process group, including Cargo/OpenCode descendants.
            let killed = Command::new("kill")
                .args(["-KILL", "--", &format!("-{}", child.id())])
                .status();
            if !killed.is_ok_and(|s| s.success()) {
                let _ = child.kill();
            }
            let _ = child.wait();
            writeln!(
                OpenOptions::new().append(true).open(log)?,
                "\nTIMEOUT after {secs}s"
            )?;
            return Err(format!("Command timed out; see {}", log.display()).into());
        }
        thread::sleep(Duration::from_millis(40));
    }
}

fn gates(project: &Path, logs: &Path, prefix: &str, timeout: u64) -> Result<Option<PathBuf>> {
    for (name, args) in GATES {
        let log = logs.join(format!("{prefix}-{name}.log"));
        let mut cmd = Command::new("cargo");
        cmd.args(*args).env("CARGO_TERM_COLOR", "never");
        let mut ok = execute(cmd, project, &log, timeout)?;
        if ok && *name == "tests" {
            let output = fs::read_to_string(&log)?;
            let passed = output
                .lines()
                .filter_map(|line| {
                    line.strip_prefix("test result: ok. ")?
                        .split_whitespace()
                        .next()?
                        .parse::<usize>()
                        .ok()
                })
                .sum::<usize>();
            if passed == 0 {
                writeln!(
                    OpenOptions::new().append(true).open(&log)?,
                    "No executed passing tests; add backend behavior tests first."
                )?;
                ok = false;
            }
        }
        println!(
            "{} {name}: {}",
            if ok { "PASS" } else { "FAIL" },
            log.display()
        );
        if !ok {
            return Ok(Some(log));
        }
    }
    Ok(None)
}

fn json(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn validate(original: &Tree, candidate: &Tree) -> Result<Vec<PathBuf>> {
    let mut changed = Vec::new();
    for (path, before) in original {
        let after = candidate
            .get(path)
            .ok_or_else(|| format!("Deletion forbidden: {}", path.display()))?;
        if before != after {
            if !path.starts_with("src") || path.extension().is_none_or(|x| x != "rs") {
                return Err(format!("Protected file changed: {}", path.display()).into());
            }
            // Conservative: source files containing inline tests are entirely frozen.
            // Use tests/ integration tests so normal implementation files remain repairable.
            let text = String::from_utf8_lossy(before);
            if text.contains("#[test]") || text.contains("cfg(test)") {
                return Err(
                    format!("File contains frozen inline tests: {}", path.display()).into(),
                );
            }
            changed.push(path.clone());
        }
    }
    // Keep the first iteration narrow: edits only, no new/deleted files.
    for path in candidate.keys() {
        if !original.contains_key(path) {
            return Err(format!("New file forbidden: {}", path.display()).into());
        }
    }
    Ok(changed)
}

fn promote(original: &Tree, candidate: &Tree, project: &Path, changed: &[PathBuf]) -> Result<()> {
    if snapshot(project)? != *original {
        return Err("Project changed during repair; refusing to overwrite concurrent edits".into());
    }
    let mut written: Vec<&PathBuf> = Vec::new();
    for path in changed {
        written.push(path);
        if let Err(error) = fs::write(project.join(path), &candidate[path]) {
            for done in written {
                fs::write(project.join(done), &original[done])?;
            }
            return Err(error.into());
        }
    }
    Ok(())
}

fn run() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 || !matches!(args[1].as_str(), "check" | "repair") || args[2] != "--project" {
        return Err("Usage: rust-loop check|repair --project /path/to/backend [--max-attempts 3] [--timeout-secs 600]".into());
    }
    let mut attempts = 3usize;
    let mut timeout = 600u64;
    for pair in args[4..].chunks(2) {
        if pair.len() != 2 {
            return Err("Missing option value".into());
        }
        match pair[0].as_str() {
            "--max-attempts" => attempts = pair[1].parse()?,
            "--timeout-secs" => timeout = pair[1].parse()?,
            _ => return Err(format!("Unknown option: {}", pair[0]).into()),
        }
    }
    if !(1..=5).contains(&attempts) || !(1..=1800).contains(&timeout) {
        return Err("Attempts must be 1..5, timeout 1..1800 seconds per command".into());
    }
    let project = fs::canonicalize(&args[3])?;
    if !project.join("Cargo.toml").is_file() || !project.join("Cargo.lock").is_file() {
        return Err(
            "Need standalone backend Cargo.toml and Cargo.lock; generate the lockfile first".into(),
        );
    }
    let state = project.join(".rust-loop");
    if state
        .symlink_metadata()
        .is_ok_and(|m| m.file_type().is_symlink())
    {
        return Err("Refusing symlinked .rust-loop state directory".into());
    }
    fs::create_dir_all(&state)?;
    fs::set_permissions(&state, fs::Permissions::from_mode(0o700))?;
    let lock_path = state.join("lock");
    let mut lock = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
        .map_err(|_| "Another repair/check is running, or a stale .rust-loop/lock needs review")?;
    writeln!(lock, "{}", std::process::id())?;
    let _guard = Lock(lock_path);
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    let run_dir = state.join(format!("{stamp}-{}", std::process::id()));
    fs::create_dir(&run_dir)?;
    println!("Audit: {}", run_dir.display());
    let original = snapshot(&project)?;
    materialize(&original, &run_dir.join("original"))?;
    let candidate = run_dir.join("candidate");
    materialize(&original, &candidate)?;
    // All commands run in the copy, including check mode. Original source is untouched.
    let baseline = gates(&candidate, &run_dir, "baseline", timeout)?;
    if args[1] == "check" {
        if baseline.is_some() {
            return Err("Backend checks failed; original files unchanged".into());
        }
        fs::write(run_dir.join("result.txt"), "PASS check\n")?;
        return Ok(());
    }
    if baseline.is_none() {
        println!("All gates already pass; no repair needed.");
        return Ok(());
    }
    let mut fmt = Command::new("cargo");
    fmt.args(["fmt", "--all"]);
    let _ = execute(
        fmt,
        &candidate,
        &run_dir.join("mechanical-format.log"),
        timeout,
    )?;
    let mut failed = gates(&candidate, &run_dir, "mechanical", timeout)?;
    let mut previous = snapshot(&candidate)?;
    validate(&original, &previous)?;
    let model = "local/qwen3-coder-next";
    for attempt in 1..=attempts {
        let Some(failure) = failed else {
            break;
        };
        let diagnostics = tail(&failure, 6000)?;
        let diagnostic_file = candidate.join("RUST_LOOP_DIAGNOSTICS.txt");
        fs::write(&diagnostic_file, &diagnostics)?;
        let cwd = candidate.to_string_lossy();
        let permission = format!(
            r#"{{"*":"deny","read":"allow","list":"allow","glob":"allow","grep":"allow","edit":"allow","write":"allow","apply_patch":"allow","external_directory":{{"*":"deny",{}:"allow"}}}}"#,
            json(&format!("{cwd}/*"))
        );
        let overrides = format!(
            r#"{{"model":{},"small_model":{},"permission":{permission},"autoupdate":false,"share":"disabled"}}"#,
            json(model),
            json(model)
        );
        let home = env::var("HOME")?;
        let config = Path::new(&home).join(".local/share/qwen-bootstrap/opencode.json");
        if !config.is_file() {
            return Err(
                "Run bootstrap stage 2 first: local provider configuration is missing".into(),
            );
        }
        // Remove project customizations in the copy so they cannot enable broader tools.
        // Restore them before comparing the candidate against the protected snapshot.
        let mut hidden = Vec::new();
        for (path, bytes) in &original {
            if path == Path::new("opencode.json")
                || path == Path::new("opencode.jsonc")
                || path.starts_with(".opencode")
            {
                fs::remove_file(candidate.join(path))?;
                hidden.push((path.clone(), bytes.clone()));
            }
        }
        let prompt = format!("Repair this standalone Rust backend. Read RUST_LOOP_DIAGNOSTICS.txt and the localized Rust source named in diagnostics. Make the smallest implementation-only correction. You may edit EXISTING src/**/*.rs files only. Do not edit tests, inline test code, manifests, lockfiles, configuration, or create/delete files. Do not suppress lints, add unsafe, weaken validation, hardcode test answers, or change intended API behavior. Bash and task tools are disabled: an external Rust controller will run format, compilation, Clippy and tests. Focus on this failure:\n{diagnostics}");
        let mut cmd = Command::new("opencode");
        cmd.args([
            "run", "--dir", &cwd, "--agent", "build", "--format", "json", "-m", model, &prompt,
        ])
        .env("OPENCODE_CONFIG", config)
        .env("OPENCODE_CONFIG_CONTENT", overrides)
        .env("OPENCODE_PERMISSION", permission)
        .env("XDG_CONFIG_HOME", run_dir.join("xdg-config"))
        .env("XDG_DATA_HOME", run_dir.join("xdg-data"))
        .env("XDG_CACHE_HOME", run_dir.join("xdg-cache"))
        .env("XDG_STATE_HOME", run_dir.join("xdg-state"));
        let ok = execute(
            cmd,
            &candidate,
            &run_dir.join(format!("attempt-{attempt}-opencode.jsonl")),
            timeout,
        )?;
        fs::remove_file(diagnostic_file)?;
        for (path, bytes) in hidden {
            fs::write(candidate.join(path), bytes)?;
        }
        if !ok {
            return Err("OpenCode failed; original source unchanged".into());
        }
        validate(&original, &snapshot(&candidate)?)?;
        let mut fmt = Command::new("cargo");
        fmt.args(["fmt", "--all"]);
        let _ = execute(
            fmt,
            &candidate,
            &run_dir.join(format!("attempt-{attempt}-format.log")),
            timeout,
        )?;
        let current = snapshot(&candidate)?;
        validate(&original, &current)?;
        if current == previous {
            return Err(
                "No source progress; stopping instead of looping. Original source unchanged".into(),
            );
        }
        previous = current;
        failed = gates(&candidate, &run_dir, &format!("attempt-{attempt}"), timeout)?;
    }
    if failed.is_some() {
        return Err("Repair attempt limit reached; original source unchanged".into());
    }
    let accepted = snapshot(&candidate)?;
    let changed = validate(&original, &accepted)?;
    let mut diff = Command::new("git");
    diff.args([
        "diff",
        "--no-index",
        "--",
        "src",
        &candidate.join("src").to_string_lossy(),
    ]);
    let _ = execute(diff, &project, &run_dir.join("accepted.diff"), timeout)?;
    promote(&original, &accepted, &project, &changed)?;
    fs::write(
        run_dir.join("result.txt"),
        format!("PASS repair; {} source files promoted\n", changed.len()),
    )?;
    println!(
        "PASS: all five gates; {} source files promoted. Review accepted.diff and test behavior.",
        changed.len()
    );
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("ERROR: {error}");
        std::process::exit(1);
    }
}
