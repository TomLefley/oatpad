default:
    @just --list

install:
    npm install

run:
    npm run dev

test:
    npm test
    cd mcp && npm test

test-watch:
    npm run test:watch

check:
    npm run check

build:
    npm run build

run-app:
    npm run tauri:dev

# Run the native app in "fresh" mode — disables read/write of localStorage
# and the meetings dir. Useful for exercising first-launch UX without
# manually clearing prefs and data.
run-app-fresh:
    VITE_FRESH=1 npm run tauri:dev

build-app:
    npm run tauri:build

build-mcpb:
    cd mcp && npm install && npm run pack
