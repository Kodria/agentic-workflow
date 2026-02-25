# 2026-02-25-awm-uninstall-mechanism-design

## Overview
AWM currently lacks a straightforward method for users to uninstall the CLI tool and clean up its internal files. This design proposes a remote uninstallation script approach, symmetric to the installation process.

## Goals
- Allow users to completely uninstall the `awm` CLI binary.
- Clean up AWM's source code and registry cache (`~/.awm`).
- **Protect User Data**: Ensure that personal skills, workflows, and configurations stored in `~/.agents` and `~/.gemini/antigravity/global_workflows` are NOT deleted.
- Provide a seamless UX matching the installation process.

## Approach: Remote Bash Script

Users will uninstall AWM by running a one-liner curl command in their terminal, matching how they installed it:

```bash
curl -fsSL https://raw.githubusercontent.com/Kodria/agentic-workflow/master/uninstall.sh | bash
```

### Architecture Updates
1. **`uninstall.sh`**: A new root-level bash script hosted in the `Kodria/agentic-workflow` repository.
2. **Execution Steps**:
   - The script will globally unlink the npm package (`npm rm -g agentic-workflow-manager`).
   - The script will recursively delete the `~/.awm` directory, removing the CLI source and registry cache.
3. **Safety Mechanism**: The script will explicitly *not* target `~/.agents` or `~/.gemini/`. Upon successful execution, it will print a confirmation message stating that these directories have been preserved to protect personal artifacts.
4. **Documentation**: The `README.md` will be updated to display the `curl` uninstallation command instead of instructing users to run a local `./uninstall.sh`. 

## Rationale
This approach is preferred over an embedded `awm uninstall` command because it completely avoids the complex edge cases of a Node.js process attempting to delete its own source files and global symlinks while executing. It is standard practice for tools installed via a shell script to provide an equivalent uninstallation shell script.
