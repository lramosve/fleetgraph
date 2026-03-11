#!/bin/bash
#
# Check for empty Playwright tests (tests with only TODO comments)
#
# Empty tests pass silently, which is a footgun. This script fails if any
# test body contains only a // TODO: comment without actual test logic.
#
# SOLUTION: Use test.fixme() for stub tests instead of empty test bodies:
#   test.fixme('my test', async ({ page }) => {
#     // TODO: implement this test
#   });
#

set -e

E2E_DIR="${1:-e2e}"

if [ ! -d "$E2E_DIR" ]; then
  echo "E2E directory not found: $E2E_DIR"
  exit 0
fi

# Find tests that are empty (no expect() or page. calls).
# Uses stateful awk parsing to track test bodies.
# Excludes test.fixme/test.skip/test.todo which are proper stub markers.

found_empty=0
declare -a files_with_empty

for f in "$E2E_DIR"/*.spec.ts; do
  if [ ! -f "$f" ]; then
    continue
  fi

  # Use awk for stateful parsing of test bodies
  empty_count=$(awk '
    /^[[:space:]]*test\(/ && !/test\.fixme/ && !/test\.skip/ && !/test\.todo/ {
      in_test = 1
      has_content = 0
    }
    in_test && /expect\(/ {
      has_content = 1
    }
    in_test && /page\./ {
      has_content = 1
    }
    in_test && /apiServer\./ {
      has_content = 1
    }
    in_test && /request\./ {
      has_content = 1
    }
    in_test && /context\./ {
      has_content = 1
    }
    in_test && /^\s*}\);/ {
      if (!has_content) {
        empty_count++
      }
      in_test = 0
    }
    END { print empty_count + 0 }
  ' "$f")

  if [ "$empty_count" -gt 0 ]; then
    found_empty=1
    files_with_empty+=("$empty_count empty tests in $(basename "$f")")
  fi
done

if [ "$found_empty" -eq 1 ]; then
  echo ""
  echo "ERROR: Empty tests detected!"
  echo "========================================"
  echo ""
  echo "The following tests have only TODO comments and will SILENTLY PASS:"
  echo ""

  for msg in "${files_with_empty[@]}"; do
    echo "  $msg"
  done

  echo ""
  echo "FIX: Convert empty tests to test.fixme():"
  echo ""
  echo "  // WRONG - silently passes"
  echo "  test('my test', async ({ page }) => {"
  echo "    // TODO: implement"
  echo "  });"
  echo ""
  echo "  // RIGHT - shows as 'fixme' in report"
  echo "  test.fixme('my test', async ({ page }) => {"
  echo "    // TODO: implement"
  echo "  });"
  echo ""
  exit 1
fi

echo "No empty tests found."
