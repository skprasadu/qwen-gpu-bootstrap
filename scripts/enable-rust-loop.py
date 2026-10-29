import pathlib, sys, time
app, root = map(pathlib.Path, sys.argv[1:])
section = (root / 'templates/rust-loop-instructions.md').read_text()
agents = app / 'AGENTS.md'
old = agents.read_text() if agents.exists() else ''
if '<!-- rust-loop-v2 -->' not in old:
    if agents.exists():
        backup = app / f'AGENTS.md.before-rust-loop-{time.time_ns()}'
        backup.write_text(old)
    agents.write_text(old.rstrip() + '\n\n' + section)
ignore = app / '.gitignore'
previous = ignore.read_text() if ignore.exists() else ''
if '.rust-loop/' not in previous.splitlines():
    ignore.write_text(previous.rstrip() + '\n.rust-loop/\n')
print(f'Enabled Rust repair gates in {agents}; existing application code was not changed.')
