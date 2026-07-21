import os
import sys
import json
import re
import subprocess
from pathlib import Path

OFFICIAL_PATH = Path(__file__).resolve().parent

DEFAULT_CLASP_EXTENSIONS = {".gs", ".js", ".html", ".json"}
SECRET_SCAN_EXTENSIONS = {
    ".gs", ".js", ".mjs", ".cjs", ".json", ".py", ".html",
    ".css", ".toml", ".yaml", ".yml"
}
SECRET_NAME_PATTERN = re.compile(r"(TOKEN|SECRET|API_KEY|ACCESS_TOKEN|CHANNEL_TOKEN|PASSWORD)", re.IGNORECASE)
STRING_LITERAL_PATTERN = re.compile(r"""(['"])([^'"]{1,600})\1""")
BEARER_LITERAL_PATTERN = re.compile(r"Bearer\s+([A-Za-z0-9._~+/=-]{40,})")
LINE_TOKEN_SHAPE_PATTERN = re.compile(r"^[A-Za-z0-9+/]{120,}={0,2}$")

SAFE_SECRET_LITERALS = {
    "",
    "REMOVED_LEGACY_TOKEN",
    "REPLACE_ME",
    "YOUR_TOKEN_HERE",
    "LINE_CHANNEL_ACCESS_TOKEN",
    "JINGYANG_LINE_CHANNEL_ACCESS_TOKEN",
}

def fail(msg, code="CROSS_PROJECT_SOURCE_BLOCKED"):
    print(f"Error: {msg}")
    print(f"Code: {code}")
    sys.exit(1)

def mask_secret(value):
    value = str(value)
    if len(value) <= 8:
        return value[:1] + "…" + value[-1:]
    return value[:4] + "…" + value[-4:]

def check_env():
    cwd = Path.cwd().resolve()

    # 1. Block Google Drive sync directories
    if any(keyword in str(OFFICIAL_PATH) for keyword in ["CloudStorage", "GoogleDrive", "Google Drive"]):
        fail(
            f"Running deploy script from cloud-synchronized folder (Google Drive) is blocked for safety: {OFFICIAL_PATH}",
            "GOOGLE_DRIVE_PATH_BLOCKED"
        )

    # 2. Cross-project safeguard: cwd must reside within OFFICIAL_PATH
    try:
        cwd.relative_to(OFFICIAL_PATH)
    except ValueError:
        fail(
            f"Current directory {cwd} is not within the repository root {OFFICIAL_PATH}",
            "CROSS_PROJECT_SOURCE_BLOCKED"
        )

    # 3. Repository markers validation
    backend_marker = OFFICIAL_PATH / "google-apps-script" / "Code.gs"
    bot_marker = OFFICIAL_PATH / "line-bot-apps-script" / "src" / "line程式碼.gs"
    if not backend_marker.exists() or not bot_marker.exists():
        fail(
            f"Repository markers not found under {OFFICIAL_PATH}. Please ensure this is the correct repository root.",
            "INVALID_REPOSITORY_ROOT"
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

def is_legacy_path(path):
    return any(part.casefold() == "legacy" for part in Path(path).parts)

def is_safe_secret_literal(value):
    value = str(value or "").strip()
    if value in SAFE_SECRET_LITERALS:
        return True
    if value.startswith("${") and value.endswith("}"):
        return True
    if "process.env" in value or "PropertiesService" in value:
        return True
    if value.startswith("http://") or value.startswith("https://"):
        return True
    if value.startswith("AKfyc"):
        return True
    return False

def is_secret_assignment_context(line, literal_start):
    prefix = line[:literal_start]
    return re.search(
        r"""(?i)(["']?[A-Za-z0-9_]*(TOKEN|SECRET|API_KEY|ACCESS_TOKEN|CHANNEL_TOKEN|PASSWORD)[A-Za-z0-9_]*["']?\s*[:=]\s*)$""",
        prefix
    ) is not None

def secret_category_for_literal(line, literal, literal_start):
    literal = str(literal or "").strip()
    if is_safe_secret_literal(literal):
        return None

    bearer_match = BEARER_LITERAL_PATTERN.search(literal)
    if bearer_match:
        return "hardcoded_bearer_token"

    if LINE_TOKEN_SHAPE_PATTERN.match(literal):
        return "line_channel_access_token_literal"

    if is_secret_assignment_context(line, literal_start) and len(literal) >= 40:
        has_alpha = any(ch.isalpha() for ch in literal)
        has_digit = any(ch.isdigit() for ch in literal)
        if has_alpha and has_digit:
            return "secret_named_long_literal"

    return None

def scan_file_for_secrets(path, rel_path):
    findings = []
    if path.suffix not in SECRET_SCAN_EXTENSIONS:
        return findings
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return findings

    for line_no, line in enumerate(content.splitlines(), start=1):
        for match in STRING_LITERAL_PATTERN.finditer(line):
            literal = match.group(2)
            category = secret_category_for_literal(line, literal, match.start())
            if not category:
                continue
            findings.append({
                "path": str(rel_path),
                "line": line_no,
                "category": category,
                "masked": mask_secret(literal),
                "length": len(literal),
            })
    return findings

def validate_upload_candidates(root_dir, upload_candidates):
    legacy_candidates = [path for path in upload_candidates if is_legacy_path(path)]
    if legacy_candidates:
        for path in legacy_candidates:
            print(f"LEGACY_FILE_IN_UPLOAD_SCOPE: {path}")
        fail("Legacy files must not be included in Apps Script upload scope", "LEGACY_FILE_IN_UPLOAD_SCOPE")

    findings = []
    for rel_path in upload_candidates:
        abs_path = root_dir / rel_path
        findings.extend(scan_file_for_secrets(abs_path, rel_path))

    if findings:
        for item in findings:
            print(
                "POTENTIAL_SECRET_LITERAL: "
                f"{item['path']}:{item['line']} "
                f"category={item['category']} "
                f"masked={item['masked']} "
                f"length={item['length']}"
            )
        fail("Potential secret literal found in Apps Script upload scope", "POTENTIAL_SECRET_LITERAL")

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
        validate_upload_candidates(root_dir, upload_candidates)

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

    root_dir, upload_candidates = get_upload_candidates(target_dir, clasp_conf)
    validate_upload_candidates(root_dir, upload_candidates)
    
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
