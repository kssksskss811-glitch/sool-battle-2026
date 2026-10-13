"""Exercise the actual workflow input gate against disposable local Git clones."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class WorkflowInputGateTests(unittest.TestCase):
    def test_latest_same_input_and_superseded_input(self):
        bash = shutil.which("bash") or r"C:\Program Files\Git\bin\bash.exe"
        if not Path(bash).is_file() or not shutil.which("git"):
            self.skipTest("Git and Bash are required for the workflow gate test")
        workflow = (ROOT / ".github/workflows/manual.yml").read_text("utf-8")
        block = re.search(r"        id: input\n        run: \|\n((?:          .*\n)+)", workflow).group(1)
        script = "\n".join(line[10:] for line in block.splitlines()) + "\n"
        event = workflow.split("permissions:", 1)[0]
        self.assertIn("branches: [main]", event)
        self.assertIn("paths: ['inputs/closing-prices.json']", event)
        self.assertNotIn("workflow_dispatch", event)
        self.assertNotIn("schedule:", event)
        self.assertNotIn("update_prices.py", workflow)
        with tempfile.TemporaryDirectory(prefix="sool-gate-", dir=ROOT.parent) as folder:
            temp = Path(folder).resolve()
            assert temp.is_relative_to(ROOT.parent.resolve())
            origin, producer, runner = (temp / name for name in ("origin.git", "producer", "runner"))

            def git(cwd, *args):
                result = subprocess.run(["git", "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", *args], cwd=cwd, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                return result.stdout.strip()

            git(temp, "init", "--bare", "--initial-branch=main", str(origin))
            git(temp, "clone", "--no-hardlinks", str(origin), str(producer))
            (producer / "inputs").mkdir()
            (producer / "inputs/closing-prices.json").write_text("{}\n", "utf-8")
            git(producer, "add", ".")
            git(producer, "commit", "-m", "fixture input")
            git(producer, "push", "origin", "main")
            git(temp, "clone", "--no-hardlinks", str(origin), str(runner))
            script_path = temp / "gate.sh"
            script_path.write_text(script, "utf-8")
            subprocess.run([bash, "-n", script_path.as_posix()], check=True, capture_output=True)
            output = temp / "output"

            def gate(expected):
                output.write_text("", "utf-8")
                env = {**os.environ, "GITHUB_OUTPUT": output.as_posix()}
                subprocess.run([bash, "-e", script_path.as_posix()], cwd=runner, env=env, capture_output=True, check=True)
                self.assertEqual(output.read_text("utf-8"), f"current={expected}\n")

            gate("true")
            (producer / "data").mkdir()
            (producer / "data/prices.json").write_text("{}\n", "utf-8")
            git(producer, "add", ".")
            git(producer, "commit", "-m", "fixture results only")
            git(producer, "push", "origin", "main")
            changed_paths = git(producer, "diff", "--name-only", "HEAD~1", "HEAD").splitlines()
            self.assertNotIn("inputs/closing-prices.json", changed_paths)
            gate("true")
            self.assertEqual(git(runner, "rev-parse", "HEAD"), git(producer, "rev-parse", "HEAD"))
            (producer / "inputs/closing-prices.json").write_text('{"next":true}\n', "utf-8")
            git(producer, "add", ".")
            git(producer, "commit", "-m", "fixture newer input")
            git(producer, "push", "origin", "main")
            gate("false")


if __name__ == "__main__":
    unittest.main()
