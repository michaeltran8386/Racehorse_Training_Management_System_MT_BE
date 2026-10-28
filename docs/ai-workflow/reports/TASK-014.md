# HUMAN QA — READY

| Parameter | Value |
| :--- | :--- |
| **Plan Version** | v1-approved-r19 |
| **Authorized Scope (CR-020 / R-1 to R-4)** | Exactly 3 root scripts: `setup-db.bat`, `start.bat`, `stop.bat` |
| **Target Database** | Local PostgreSQL `equiflow` on `localhost:5432` (Docker container `equiflow-postgres`) |
| **One-Click Reset Script** | `setup-db.bat` (Exclusively resets/seeds local PostgreSQL; validates DATABASE_URL before mutation) |
| **One-Click Launch Script** | `start.bat` (Non-destructive; enforces strict 1-window/4-tab Windows Terminal; bounded health checks) |
| **One-Click Stop Script** | `stop.bat` (Force-stops EquiFlow listeners on 3000/5173/5175 and container, then verifies shutdown) |
| **Canonical Simulator Directory** | `Racehorse_Simulator_Web` (Port 5175) |
| **Reference Directory (Untouched)** | `Racehorse_Simulator_Web_v3` (0 modifications, 0 references in any launcher script) |
| **Health URLs** | Backend: `http://localhost:3000/api/health`<br>Frontend: `http://localhost:5173`<br>Simulator: `http://localhost:5175` |
| **Approved Lifecycle Order** | `stop.bat` -> `setup-db.bat` -> `start.bat` -> verify 4 tabs and 3 health URLs -> `stop.bat` |

---

# TASK-014 — Execution Report

- **Task Name:** TASK-014 — Three-script local setup/start/stop launcher using canonical SIM
- **Plan Version:** v1-approved-r19
- **Approved Change Request:** CR-020 (superseding the earlier two-file/three-tab QA handoff)
- **Rejection Resolution:** R-1 (DATABASE_URL target validation), R-2 (strict 1-window/4-tab wt.exe enforcement), R-3 (self-contained verification and controlled negative failure), R-4 (scope preservation).
- **Status:** DONE (Approved by Human QA on 2026-10-28)
- **Authorizing Command:** `START TASK-014` under approved CR-020 (recorded in `APPROVALS.md`)
- **Changed Application Files (Strictly 3 root scripts):**
  1. `setup-db.bat` (Root directory)
  2. `start.bat` (Root directory)
  3. `stop.bat` (Root directory)
- **Untouched Reference Directory:**
  - `Racehorse_Simulator_Web_v3`: Zero references in any script; completely untouched.
- **Sub-repository Working Trees:**
  - `Racehorse_Training_Management_System_MT_BE`: Only canonical workflow coordination documents and this report modified. Zero application source modifications.
  - `Racehorse_Training_Management_System_MT_FE`: Clean (0 modifications).
  - `Racehorse_Simulator_Web`: Clean (0 modifications).

---

## 1. Summary of Changes Implemented (R-1, R-2, R-3, R-4)

### 1.1 `setup-db.bat` (R-1: Non-Local Database Protection & Exclusivity)
- **Warning Banner:** Displays `[CANH BAO] Thao tac nay se RESET va KHOI TAO LAI toan bo du lieu PostgreSQL!` requiring `equiflow` on `localhost/127.0.0.1:5432`.
- **Target DATABASE_URL Resolution & Validation (R-1):**
  - Resolves effective `DATABASE_URL` from the active environment or `%BE_DIR%\.env`.
  - Parses using Node.js URL parser without printing username/password credentials.
  - Enforces:
    - Hostname must be `localhost`, `127.0.0.1`, or `::1` (case-insensitive, handling IPv6 brackets).
    - Port must be exactly `5432`.
    - Database name must be exactly `equiflow`.
  - Prints sanitized target: `Target resolved: Host: <host>, Port: <port>, Database: <db>`.
  - If missing, malformed, or non-local, prints descriptive error and exits immediately (`exit /b 1`) before Docker container creation, Prisma Client generation, or `npm run db:setup` executes.
- **PostgreSQL Readiness Timeout Guard:** Polls `pg_isready` up to 15 times (30 seconds) and exits non-zero (`exit /b 1`) on timeout.
- **Deterministic Seed & Exit:** Runs `npm run db:setup` and exits with code 0 with standard account credentials display only after successful seed completion.

### 1.2 `start.bat` (R-2: Strict One-Window / Four-Tab Contract & Health Checks)
- **Strict Windows Terminal Contract (R-2):**
  - Removed `LAUNCH_CMD_WINDOWS` fallback completely.
  - Checks `where wt >nul 2>&1`. If `wt.exe` is missing, prints actionable installation instructions (`winget install Microsoft.WindowsTerminal`, Microsoft Store link, GitHub Releases link) and exits with code 1.
  - Launches exactly one Windows Terminal window with four distinct tabs:
    1. Tab 1: `EquiFlow - Backend API (Port 3000)` (`npm run start:dev`)
    2. Tab 2: `EquiFlow - Frontend Web (Port 5173)` (`npm run dev`)
    3. Tab 3: `EquiFlow - Simulator Web (Port 5175)` (`npm run dev`)
    4. Tab 4: `EquiFlow - PostgreSQL Database (Docker)` (`docker logs -f --tail 50 equiflow-postgres`)
- **Canonical Simulator Switch:** Points exclusively to canonical `%~dp0Racehorse_Simulator_Web` (zero references to `_v3`).
- **Bounded Real Health Check Polling:** Polls up to 30 loops (~60s):
  - Backend API: `curl.exe -s --connect-timeout 2 --max-time 3 http://localhost:3000/api/health` verifying `"connected":true`.
  - Frontend Web: `curl.exe -s -o nul -w "%{http_code}" --connect-timeout 2 --max-time 3 http://localhost:5173` verifying HTTP 200.
  - Simulator Web: `curl.exe -s -o nul -w "%{http_code}" --connect-timeout 2 --max-time 3 http://localhost:5175` verifying HTTP 200.
- **Zero False-Success:** Reports detailed diagnostics and exits non-zero (`exit /b 1`) without opening browsers if any service fails within the timeout. Opens browser tabs (`http://localhost:5173` and `http://localhost:5175`) only when all three services pass.
- **Zero Mock Mode:** No mock mode flags or fallback runtime data enabled.

### 1.3 `stop.bat` (Forced Teardown & Post-Shutdown Verification)
- **Authorized Forced Termination:** Terminates processes on ports 3000, 5173, and 5175 via `taskkill /f /t /pid`.
- **PostgreSQL Container Shutdown:** Stops Docker container `equiflow-postgres`.
- **Teardown Verification:** Checks that ports 3000, 5173, and 5175 are closed and container `equiflow-postgres` is stopped. Exits non-zero (`exit /b 1`) with actionable diagnostics if teardown is incomplete; exits code 0 only when all 4 are verified stopped.

---

## 2. Truthful Git Delivery Limitation Disclosure

> [!WARNING]
> **Root Directory Git Delivery Limitation:**
> The EquiFlow workspace root (`MINH_Racehorse_Branch`) is a parent workspace directory and is **not** a Git repository itself. Only the three sub-directories (`Racehorse_Training_Management_System_MT_BE`, `Racehorse_Training_Management_System_MT_FE`, and `Racehorse_Simulator_Web`) are independent Git repositories.
> 
> Because `setup-db.bat`, `start.bat`, and `stop.bat` reside at the workspace root, **they cannot be delivered to team members simply by running `git pull` inside any of the three sub-repositories**.
> 
> Distributing these scripts to teammates or CI/CD pipelines requires either:
> 1. A separately approved repository layout decision (e.g. initializing a root monorepo / git submodule structure, or tracking the launcher scripts inside `BE/scripts` with root wrappers); or
> 2. Manual distribution of the three root batch scripts to team members.
> 
> As authorized by CR-020 and ADR-026, the scripts remain at the root paths for Windows developer ergonomics, and this delivery limitation is recorded truthfully.

---

## 3. Automated Verification Evidence & Reproducible Commands (R-3)

All verification below is performed using self-contained, reproducible commands without external or ephemeral scratch scripts:

### 3.1 Controlled Negative Test: Rejection of Non-Local DATABASE_URL (R-1 & R-3)
- **Command Executed:**
  ```cmd
  cmd /c "set DATABASE_URL=postgresql://secret_user:super_secret_pw@remote.production.db.com:5432/equiflow && call setup-db.bat --no-pause"
  ```
- **Exit Code:** `1`
- **Actual Output:**
  ```
  ===============================================================================
         EQUIFLOW - RACEHORSE TRAINING & STABLE MANAGEMENT SYSTEM (SWP391)
                   KHOI TAO & NAP LAI DU LIEU MAU DATABASE
  ===============================================================================
  [CANH BAO] Thao tac nay se RESET va KHOI TAO LAI toan bo du lieu PostgreSQL
             Yeu cau bat buoc: PostgreSQL 'equiflow' tren localhost/127.0.0.1:5432
  ===============================================================================

  [1/5] Kiem tra Node.js va npm...
  [V] Node.js va npm da san sang.

  [2/5] Xac thuc DATABASE_URL muc tieu (ngan chan reset tren database khong phai local)...
    Target resolved: Host: remote.production.db.com, Port: 5432, Database: equiflow
  [LOI] TU CHOI THAO TAC. setup-db.bat chi duoc phep reset database local an toan:
        - Host phai la: localhost, 127.0.0.1 hoac ::1 (Hien tai: remote.production.db.com)
        - Port phai la: 5432 (Hien tai: 5432)
        - Database phai la: equiflow (Hien tai: equiflow)

  ===============================================================================
         [LOI] XAC THUC DATABASE_URL THAT BAI - HUY THAO TAC RESET
  ===============================================================================
  ```
- **Evidence Assessment:** Proves `setup-db.bat` safely catches non-local host, scrubs credentials, prints sanitized target, and exits with code 1 before Docker, Prisma, or seed mutation executes.

### 3.2 Static Checks & Contract Verification (Self-Contained Commands)
1. **Zero `_v3` References:**
   - Command: `cmd /c "findstr /i ""_v3"" setup-db.bat start.bat stop.bat"`
   - Exit Code: `1` (0 matches found across all three launcher scripts).
2. **Strict `wt.exe` Contract & Removal of Cmd Fallback (R-2):**
   - Command: `cmd /c "findstr /i ""LAUNCH_CMD_WINDOWS"" start.bat"`
   - Exit Code: `1` (0 matches found; fallback completely removed).
   - Command: `cmd /c "findstr /i ""wt.exe"" start.bat"`
   - Exit Code: `0` (Matches `where wt >nul 2>&1`, error installation message, and `start "" wt.exe -w new nt...` 4-tab launch).
3. **Shutdown Verification in `stop.bat`:**
   - Command: `cmd /c "findstr /i ""TEARDOWN_FAILED"" stop.bat"`
   - Exit Code: `0` (Verified checks on ports 3000, 5173, 5175, and container `equiflow-postgres`).
4. **Target Resolution in `setup-db.bat` (R-1):**
   - Command: `cmd /c "findstr /i ""Target resolved"" setup-db.bat"`
   - Exit Code: `0` (Verified safe URL resolution and sanitized target printing).

### 3.3 Subsystem Builds & Test Suites
- **Simulator Production Build:**
  - Command: `npm run build` in `Racehorse_Simulator_Web`
  - Result: 108 modules transformed, `built in 1.21s`, exit code `0`.
- **Simulator Test Suite:**
  - Command: `npm test` in `Racehorse_Simulator_Web`
  - Result: 146 passed, 0 failed, exit code `0`.
- **Backend Typecheck:**
  - Command: `npm run typecheck` in `Racehorse_Training_Management_System_MT_BE`
  - Result: Exit code `0`.
- **Frontend Typecheck:**
  - Command: `npm run typecheck` in `Racehorse_Training_Management_System_MT_FE`
  - Result: Exit code `0`.

---

## 4. Manual QA Protocol for Windows

Follow the approved manual order: `stop -> setup-db -> start -> verify -> stop`:

### Step 1: Initial Teardown
1. Run `.\stop.bat` in cmd or PowerShell from the repository root (or double-click from File Explorer).
2. Verify output confirms all services and container `equiflow-postgres` are terminated:
   ```
   [THANH CONG] DA TAT VA XAC NHAN DUNG TOAN BO HE THONG EQUIFLOW
   - Backend API (Port 3000):     DA DUNG
   - Frontend Web (Port 5173):    DA DUNG
   - Simulator Web (Port 5175):   DA DUNG
   - PostgreSQL (Docker):         DA DUNG
   ```

### Step 2: Negative Test & Intentional Database Reset
1. **Controlled Negative Test:**
   - Run in cmd: `cmd /c "set DATABASE_URL=postgresql://secret:pw@remote.equiflow.com:5432/equiflow && call setup-db.bat"`
   - Verify it prints `Target resolved: Host: remote.equiflow.com, Port: 5432, Database: equiflow` and refuses execution with exit code 1. Confirm zero credentials appear on screen.
2. **Valid Reset & Seed:**
   - Run `.\setup-db.bat` normally (without custom DATABASE_URL).
   - Confirm it resolves `Host: localhost, Port: 5432, Database: equiflow`, validates local target, starts Docker PostgreSQL, generates Prisma Client, seeds 100% data, and exits with code 0.

### Step 3: Four-Tab Startup & Bounded Health Checks
1. Run `.\start.bat`.
2. Verify:
   - Git branch checks pass for Backend, Frontend, and Simulator.
   - Container `equiflow-postgres` is verified running on port 5432.
   - Exactly **one Windows Terminal window** opens with **four tabs**:
     1. `EquiFlow - Backend API (Port 3000)`
     2. `EquiFlow - Frontend Web (Port 5173)`
     3. `EquiFlow - Simulator Web (Port 5175)`
     4. `EquiFlow - PostgreSQL Database (Docker)`
   - The launcher prints bounded health checking progress:
     ```
     [*] Cho cac dich vu khoi tao va kiem tra Health Checks (Port 3000, 5173, 5175)...
       [V] Backend API & PostgreSQL da san sang! (Port 3000)
       [V] Frontend Web da san sang! (Port 5173)
       [V] Simulator Web da san sang! (Port 5175)
     ```
   - Only after all 3 health checks succeed, the success banner is displayed and browser tabs open to `http://localhost:5173` and `http://localhost:5175`.

### Step 4: Verify Simulator & Health
1. In `http://localhost:5175`, confirm the safe Vietnamese session instruction is displayed (no mock/sample data).
2. In `http://localhost:3000/api/health`, confirm JSON output:
   `"database":{"connected":true,"provider":"postgresql"}`.

### Step 5: Final Teardown
1. Run `.\stop.bat`.
2. Confirm teardown verification passes with exit code 0.

---

## 5. Gate State & STOP Marker
- `TASK-014` corrective scope addressing R-1, R-2, R-3, and R-4 is complete, verified, and approved by the human partner (`APPROVE TASK-014` on 2026-10-28).
- Workflow coordination documents are updated: `TASK-014` is marked `DONE` and execution is `IDLE`.
- Next planned task is `TASK-015` (unauthorized). The agent has **STOPPED**. No work on `TASK-015` or subsequent tasks may begin without explicit human command.

