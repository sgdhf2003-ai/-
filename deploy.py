import os
import sys
import json
import subprocess
from pathlib import Path

OFFICIAL_PATH = Path("/Users/chenhaoan/Documents/jingyang-sales-app").resolve()

DEFAULT_CLASP_EXTENSIONS = {".gs", ".js", ".html", ".json"}

def fail(msg, code="CROSS_PROJECT_SOURCE_BLOCKED"):
    print(f"Error: {msg}")
    print(f"Code: {code}")
    sys.exit(1)

def check_env():
    cwd = Path.cwd().resolve()
    try:
        cwd.relative_to(OFFICIAL_PATH)
    except ValueError:
        fail(
            f"Current directory {cwd} is not within the official path {OFFICIAL_PATH}",
            "CROSS_PROJECT_SOURCE_BLOCKED"
        )

def get_upload_candidates(target_dir, clasp_conf):
    root_dir = Path(target_dir, clasp_conf.get("rootDir", ".")).resolve()
    try:
        root_dir.relative_to(Path(target_dir).resolve())
    except ValueError:
        fail(
            f"clasp rootDir {root_dir} is outside target directory {target_dir}",
            "CLASP_ROOT_DIR_OUTSIDE_TARGET"
        )

    if not root_dir.exists() or not root_dir.is_dir():
        fail(f"clasp rootDir not found at {root_dir}", "CLASP_ROOT_DIR_MISSING")

    extensions = set()
    for key in ["scriptExtensions", "htmlExtensions", "jsonExtensions"]:
        extensions.update(clasp_conf.get(key, []))
    if not extensions:
        extensions = DEFAULT_CLASP_EXTENSIONS

    files = []
    for path in sorted(root_dir.rglob("*")):
        if path.name in [".clasp.json", ".claspignore"]:
            continue
        if path.is_file() and path.suffix in extensions:
            files.append(path.relative_to(root_dir))
    return root_dir, files

def main():
    check_env()
    
    is_check = "--check" in sys.argv
    args = [a for a in sys.argv if a != "--check"]
    
    if len(args) < 2 or args[1] not in ["backend", "line-bot"]:
        print("Usage: python3 deploy.py [backend|line-bot] [--check] [version_desc]")
        sys.exit(1)
        
    target = args[1]
    version_desc = args[2] if len(args) > 2 else "Automatic Deployment"
    
    # Read config
    config_path = os.path.join(OFFICIAL_PATH, "deployment.config.json")
    if not os.path.exists(config_path):
        fail("deployment.config.json not found", "CONFIG_MISSING")
        
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
        
    # Set targets based on argument
    if target == "backend":
        subdir = config["appsScriptSource"]
        expected_script_id = config["scriptId"]
        expected_deploy_id = config["deploymentId"]
    else:
        subdir = config["lineBot"]["appsScriptSource"]
        expected_script_id = config["lineBot"]["scriptId"]
        expected_deploy_id = config["lineBot"]["deploymentId"]
        
    target_dir = os.path.join(OFFICIAL_PATH, subdir)
    clasp_json_path = os.path.join(target_dir, ".clasp.json")
    
    if not os.path.exists(clasp_json_path):
        fail(f"clasp config not found at {clasp_json_path}", "CLASP_CONFIG_MISSING")
        
    with open(clasp_json_path, "r", encoding="utf-8") as f:
        clasp_conf = json.load(f)
        
    if clasp_conf.get("scriptId") != expected_script_id:
        fail(f"Script ID mismatch! Got {clasp_conf.get('scriptId')}, expected {expected_script_id}", "SCRIPT_ID_MISMATCH")
        
    print(f"=== Starting deployment for {target} ===")
    print(f"Target Directory: {target_dir}")
    print(f"Script ID: {expected_script_id}")
    print(f"Deployment ID: {expected_deploy_id}")

    if is_check:
        root_dir, upload_candidates = get_upload_candidates(target_dir, clasp_conf)

        print("\n=== Check Mode (Dry Run) ===")
        print("No clasp command was executed.")
        print("Skipped: clasp status")
        print("Skipped: clasp push --force")
        print(f"Skipped: clasp version {version_desc}")
        print(f"Skipped: clasp deploy -i {expected_deploy_id} -V <new_version> -d {version_desc}")
        print("\nFiles that would be uploaded:")
        for path in upload_candidates:
            print(path)
        print("\n=== Check Mode (Dry Run) Completed Successfully ===")
        print("Status: VALID")
        print(f"project root: {OFFICIAL_PATH}")
        print(f"source directory: {target_dir}")
        print(f"clasp rootDir: {root_dir}")
        print(f"script ID: {expected_script_id}")
        print(f"deployment ID: {expected_deploy_id}")
        print(f"cross-project status: SAFE (Cwd complies with boundary)")
        sys.exit(0)
    
    # Clasp status
    res = subprocess.run(["clasp", "status"], cwd=target_dir, capture_output=True, text=True)
    if res.returncode != 0:
        fail(f"clasp status failed: {res.stderr}", "CLASP_STATUS_FAILED")
        
    print("\nFiles to be uploaded:")
    print(res.stdout)
        
    # Non-interactive confirmation check
    if sys.stdin.isatty():
        ans = input("Proceed with deployment? (y/N): ")
        if ans.lower() != 'y':
            print("Deployment cancelled.")
            sys.exit(0)
            
    # Push
    print("\nPushing files...")
    res = subprocess.run(["clasp", "push", "--force"], cwd=target_dir, capture_output=True, text=True)
    if res.returncode != 0:
        fail(f"clasp push failed: {res.stderr}", "CLASP_PUSH_FAILED")
    print(res.stdout)
    
    # Create version
    print("Creating new version...")
    res = subprocess.run(["clasp", "version", version_desc], cwd=target_dir, capture_output=True, text=True)
    if res.returncode != 0:
        fail(f"clasp version failed: {res.stderr}", "CLASP_VERSION_FAILED")
    print(res.stdout)
    
    # Find version number
    version_line = [line for line in res.stdout.split("\n") if "Created version" in line]
    if not version_line:
        fail("Could not find created version number from output", "VERSION_NOT_FOUND")
    version_num = version_line[0].split(" ")[-1].strip()
    
    # Deploy
    print(f"Deploying version {version_num} to deployment {expected_deploy_id}...")
    res = subprocess.run(["clasp", "deploy", "-i", expected_deploy_id, "-V", version_num, "-d", version_desc], cwd=target_dir, capture_output=True, text=True)
    if res.returncode != 0:
        fail(f"clasp deploy failed: {res.stderr}", "CLASP_DEPLOY_FAILED")
    print(res.stdout)
    
    print("\n[DEPLOY_RESULT]")
    print("success=true")
    print(f"scriptId={expected_script_id}")
    print(f"deploymentId={expected_deploy_id}")
    print(f"version={version_num}")
    print(f"webAppUrl=https://script.google.com/macros/s/{expected_deploy_id}/exec")

if __name__ == "__main__":
    main()
