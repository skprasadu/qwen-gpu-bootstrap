import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request }) => {
  const response = await request.get("/api/todos");
  expect(response.ok()).toBeTruthy();
  for (const todo of await response.json())
    expect((await request.delete(`/api/todos/${todo.id}`)).status()).toBe(204);
});
test("HTTP CRUD and invalid input", async ({ request }) => {
  expect(
    (await request.post("/api/todos", { data: { title: " " } })).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/todos", { data: { title: "x".repeat(201) } })
    ).status(),
  ).toBe(400);
  const created = await request.post("/api/todos", {
    data: { title: "HTTP task" },
  });
  expect(created.status()).toBe(201);
  const todo = await created.json();
  expect(todo.completed).toBe(false);
  const changed = await request.patch(`/api/todos/${todo.id}`, {
    data: { title: "Changed", completed: true },
  });
  expect(await changed.json()).toEqual({
    id: todo.id,
    title: "Changed",
    completed: true,
  });
  expect(
    (
      await request.patch(`/api/todos/${todo.id}`, {
        data: { completed: false },
      })
    ).status(),
  ).toBe(200);
  expect((await request.get("/api/todos")).ok()).toBeTruthy();
  expect((await request.delete(`/api/todos/${todo.id}`)).status()).toBe(204);
  expect(
    (
      await request.patch(`/api/todos/${todo.id}`, {
        data: { completed: true },
      })
    ).status(),
  ).toBe(404);
});
test("browser CRUD persists after refresh", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("New task", { exact: true }).fill("Browser task");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  let task = page.getByTestId("task").filter({ hasText: "Browser task" });
  await expect(task).toBeVisible();
  await task.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByLabel("Edit title", { exact: true })
    .fill("Edited browser task");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  task = page.getByTestId("task").filter({ hasText: "Edited browser task" });
  await expect(task).toBeVisible();
  await task.getByRole("button", { name: "Complete", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/todos")).json())[0]?.completed,
    )
    .toBe(true);
  // The focus view must provide access to completed tasks to reopen/delete them.
  if (process.env.P2I_VARIANT === "focus")
    await page.getByRole("button", { name: "Completed", exact: true }).click();
  task = page.getByTestId("task").filter({ hasText: "Edited browser task" });
  await task.getByRole("button", { name: "Reopen", exact: true }).click();
  if (process.env.P2I_VARIANT === "focus")
    await page.getByRole("button", { name: "Active", exact: true }).click();
  task = page.getByTestId("task").filter({ hasText: "Edited browser task" });
  await task.getByRole("button", { name: "Delete", exact: true }).click();
  await expect
    .poll(async () => await (await request.get("/api/todos")).json())
    .toEqual([]);
  await expect(task).toHaveCount(0);
});
test("required variant behavior", async ({ page, request }) => {
  await request.post("/api/todos", { data: { title: "First active" } });
  await request.post("/api/todos", { data: { title: "Second active" } });
  const completed = await (
    await request.post("/api/todos", { data: { title: "Finished task" } })
  ).json();
  await request.patch(`/api/todos/${completed.id}`, {
    data: { completed: true },
  });
  await page.goto("/");
  const variant = process.env.P2I_VARIANT;
  if (variant === "list") {
    await page.getByRole("button", { name: "Active", exact: true }).click();
    await expect(page.getByTestId("task")).toHaveCount(2);
    await expect(
      page.getByTestId("task").filter({ hasText: "Finished task" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Completed", exact: true }).click();
    await expect(page.getByTestId("task")).toHaveCount(1);
    await expect(page.getByTestId("task")).toContainText("Finished task");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByTestId("task")).toHaveCount(3);
  } else if (variant === "kanban") {
    const active = page.getByRole("region", {
      name: "Active tasks",
      exact: true,
    });
    const done = page.getByRole("region", {
      name: "Completed tasks",
      exact: true,
    });
    await expect(active.getByTestId("task")).toHaveCount(2);
    await expect(done.getByTestId("task")).toHaveCount(1);
    await active
      .getByTestId("task")
      .filter({ hasText: "First active" })
      .getByRole("button", { name: "Complete", exact: true })
      .click();
    await expect(active.getByTestId("task")).toHaveCount(1);
    await expect(done.getByTestId("task")).toHaveCount(2);
  } else if (variant === "focus") {
    await expect(page.getByTestId("task")).toHaveCount(1);
    await expect(page.getByTestId("task")).toContainText("First active");
    await page.getByRole("button", { name: "Next task", exact: true }).click();
    await expect(page.getByTestId("task")).toContainText("Second active");
    await page
      .getByRole("button", { name: "Previous task", exact: true })
      .click();
    await expect(page.getByTestId("task")).toContainText("First active");
  } else {
    expect(variant).toBe("template");
    await expect(page.getByTestId("task")).toHaveCount(3);
  }
});
test("malformed API response is rejected at runtime", async ({ page }) => {
  await page.route("**/api/todos", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "invalid", title: "INVALID RESPONSE", completed: "yes" },
      ]),
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("alert").filter({ hasText: /unable|error|invalid|failed/i }),
  ).toBeVisible();
  await expect(page.getByTestId("task")).toHaveCount(0);
});
