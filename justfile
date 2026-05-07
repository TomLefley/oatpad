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

# Bump the patch version across package.json, src/Cargo.toml and
# src/tauri.conf.json, refresh lockfiles, commit, and create a v* tag.
# Push with `git push && git push --tags` to trigger the release workflow.
release-patch:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -n "$(git status --porcelain)" ]; then
      echo "Working tree has uncommitted changes — aborting." >&2
      exit 1
    fi
    current=$(node -p "require('./package.json').version")
    IFS=. read -r maj min pat <<< "$current"
    next="${maj}.${min}.$((pat + 1))"
    echo "Bumping ${current} → ${next}"
    npm version --no-git-tag-version "$next" >/dev/null
    sed -i.bak "s/^version = \".*\"/version = \"${next}\"/" src/Cargo.toml
    rm src/Cargo.toml.bak
    node -e "const fs=require('fs');const p='src/tauri.conf.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version='${next}';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')"
    (cd src && cargo update -p oatpad >/dev/null)
    git add package.json package-lock.json src/Cargo.toml src/Cargo.lock src/tauri.conf.json
    git commit -m "Bump version to ${next}"
    git tag "v${next}"
    echo "Tagged v${next}. Push with: git push && git push --tags"
