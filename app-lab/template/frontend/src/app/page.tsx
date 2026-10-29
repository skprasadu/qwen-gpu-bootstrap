"use client";
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  createTodo,
  deleteTodo,
  listTodos,
  updateTodo,
} from "../../generated/sdk.gen";
import type { Todo } from "../../generated/types.gen";

export default function Page() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function refresh() {
    const response = await listTodos({ throwOnError: true });
    setTodos(response.data);
  }
  useEffect(() => {
    refresh()
      .catch(() => setError("Unable to load tasks. Please retry."))
      .finally(() => setLoading(false));
  }, []);
  async function act(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
    } catch {
      setError("Unable to save your change. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Paper sx={{ p: 4 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="overline">P2I / LOCAL PROTOTYPE</Typography>
            <Typography variant="h3" component="h1">
              Your tasks
            </Typography>
            <Typography color="text.secondary">
              Changes last until this backend restarts.
            </Typography>
          </Box>
          {error && (
            <Alert severity="error">
              {error}
              <Button onClick={() => void act(refresh)}>Retry</Button>
            </Alert>
          )}
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!title.trim() || title.trim().length > 200) {
                setError("Enter a title between 1 and 200 characters.");
                return;
              }
              void act(async () => {
                await createTodo({ body: { title }, throwOnError: true });
                setTitle("");
              });
            }}
          >
            <Stack direction="row" spacing={2}>
              <TextField
                label="New task"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                fullWidth
              />
              <Button type="submit" variant="contained" disabled={busy}>
                Add task
              </Button>
            </Stack>
          </Box>
          {loading ? (
            <CircularProgress aria-label="Loading tasks" />
          ) : todos.length === 0 ? (
            <Typography>No tasks yet.</Typography>
          ) : (
            todos.map((todo) => (
              <Paper
                variant="outlined"
                key={todo.id}
                data-testid="task"
                sx={{ p: 2 }}
              >
                <Stack spacing={1}>
                  {editing === todo.id ? (
                    <>
                      <TextField
                        label="Edit title"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                      <Button
                        disabled={
                          busy || !draft.trim() || draft.trim().length > 200
                        }
                        onClick={() =>
                          void act(async () => {
                            await updateTodo({
                              path: { id: todo.id },
                              body: { title: draft },
                              throwOnError: true,
                            });
                            setEditing(null);
                          })
                        }
                      >
                        Save
                      </Button>
                    </>
                  ) : (
                    <Typography
                      sx={{
                        textDecoration: todo.completed
                          ? "line-through"
                          : "none",
                      }}
                    >
                      {todo.title}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1}>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setEditing(todo.id);
                        setDraft(todo.title);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          updateTodo({
                            path: { id: todo.id },
                            body: { completed: !todo.completed },
                            throwOnError: true,
                          }),
                        )
                      }
                    >
                      {todo.completed ? "Reopen" : "Complete"}
                    </Button>
                    <Button
                      color="error"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          deleteTodo({
                            path: { id: todo.id },
                            throwOnError: true,
                          }),
                        )
                      }
                    >
                      Delete
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            ))
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
