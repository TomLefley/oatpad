default:
    @just --list

install:
    npm install

run:
    npm run dev

# Run in "fresh" mode — disables read/write of localStorage and the meetings
# dir. Useful for exercising first-launch UX without manually clearing prefs
# and data.
run-fresh:
    VITE_FRESH=1 npm run dev

build:
    npm run build

run-web:
    npm run dev:web

build-web:
    npm run build:web

test:
    npm test
    cd mcp && npm test

test-watch:
    npm run test:watch

check:
    npm run check

build-mcpb:
    cd mcp && npm install && npm run pack
