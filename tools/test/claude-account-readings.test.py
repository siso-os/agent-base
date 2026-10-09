"""Fixture-only tests: donor functions never see an unapproved config."""
import importlib.util
import pathlib
import tempfile
import json
import unittest
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("account_readings", pathlib.Path(__file__).parents[1] / "claude-account-readings.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class AccountReadings(unittest.TestCase):
    def test_credits_filters_before_fetch_and_strips_private_columns(self):
        namespace = {"LOGINS": [("claude-siso", "~/.claude-siso"), ("claude-fahmy", "~/.config/claude-fahmy"), ("claude-siso-3", "~/.config/claude-fahmy")]}
        exec('def read_all():\n return [{"login":login,"email":"private-sentinel","grants":[{"left_usd":4,"ends":None}]} for login,config in LOGINS]', namespace)
        rows = module.credits(namespace)
        self.assertEqual(rows,[{"id":"claude-siso","credits":[{"left":4,"ends":None}]}])
        self.assertNotIn("private-sentinel", json.dumps(rows))
        self.assertEqual(namespace["LOGINS"], [("claude-siso", "~/.claude-siso")])

    def test_renewals_joins_by_config_and_never_reads_protected_plan(self):
        with tempfile.TemporaryDirectory(prefix=".siso-ephemeral-account-reader.") as root:
            file=pathlib.Path(root)/"plans.json"
            file.write_text(json.dumps({"plans":[{"kind":"claude","config":"~/.config/claude-siso-3","name":"private-sentinel"},{"kind":"claude","config":"~/.config/claude-fahmy"},{"kind":"codex","config":"~/.claude-siso"}]}))
            called=[]
            def read(plan, now):
                called.append(plan["config"])
                return {"renews":"2026-11-08T00:00:00Z","status":"active","token":"private-sentinel"}
            rows=module.renewals({"CONF":str(file),"claude_plan":read})
            self.assertEqual(called,["~/.config/claude-siso-3"])
            self.assertEqual(rows,[{"id":"claude-siso-3","renews":"2026-11-08T00:00:00Z","renewalStatus":"active"}])
            self.assertNotIn("private-sentinel",json.dumps(rows))

if __name__ == '__main__':
    unittest.main()
