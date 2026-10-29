# Constrained frontend task
Use Next.js App Router, TypeScript and Material UI already installed here.
Edit frontend/src only. Import the generated SDK from frontend/generated;
its response validators are enabled. Preserve backend/API/configuration/dependencies.
Use relative /api requests. Do not start servers in a temporary shell: the
controller builds, starts, tests and publishes your captured source independently.
You may run `npm run typecheck -- --incremental false` in frontend.
Use accessible controls: New task, Add task, Edit, Edit title, Save, Complete,
Reopen, Delete. Each displayed task has data-testid="task". Show loading and error
states. Keep every CRUD action available, including reopening completed tasks.
List filters: All, Active, Completed. Kanban regions: Active tasks, Completed tasks.
Focus: one selected active task; Next task and Previous task buttons; Active and
Completed buttons to access both states. These are the public interaction contract.
Do not weaken tests or claim a check passed without execution. Finish after writing
the implementation; the controller will return concrete failures for repair.
