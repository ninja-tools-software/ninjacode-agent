import { describe, expect, it } from "vitest";
import { classifyShellDanger } from "./shellDanger.js";

const destructive = (command: string) => classifyShellDanger(command) !== null;

describe("classifyShellDanger", () => {
  it("leaves ordinary development commands alone", () => {
    const safe = [
      "ls -la",
      "git status -s",
      "git push origin main",
      "pnpm test",
      "pnpm build && pnpm lint",
      "rm dist/bundle.js",
      "cat package.json | grep name",
      "echo done > /dev/null",
      "docker compose up -d",
      "kubectl get pods",
      "chmod +x scripts/build.sh",
      "find . -name '*.ts'",
      "curl https://example.com -o page.html",
    ];
    for (const command of safe) {
      expect(classifyShellDanger(command), command).toBeNull();
    }
  });

  it("flags recursive and out-of-workspace deletes", () => {
    expect(destructive("rm -rf node_modules")).toBe(true);
    expect(destructive("rm -fr build")).toBe(true);
    expect(destructive("rm -r -f build")).toBe(true);
    expect(destructive("rm --recursive build")).toBe(true);
    expect(destructive("rm -f /etc/hosts")).toBe(true);
    expect(destructive("rm -f ~/.zshrc")).toBe(true);
    expect(destructive("rm ../outside.txt")).toBe(true);
  });

  it("flags a dangerous command hidden in a later segment", () => {
    expect(destructive("pnpm build && rm -rf /")).toBe(true);
    expect(destructive("echo cleaning; sudo rm -rf /var")).toBe(true);
    expect(destructive("cat list.txt | xargs rm -r")).toBe(true);
  });

  it("distinguishes dangerous git subcommands from ordinary ones", () => {
    expect(destructive("git push --force origin main")).toBe(true);
    expect(destructive("git push -f")).toBe(true);
    expect(destructive("git push --force-with-lease")).toBe(true);
    expect(destructive("git push --delete origin feature")).toBe(true);
    expect(destructive("git reset --hard HEAD~3")).toBe(true);
    expect(destructive("git clean -fd")).toBe(true);
    expect(destructive("git branch -D feature")).toBe(true);
    expect(destructive("git filter-branch --all")).toBe(true);
    expect(destructive("git reset HEAD~1")).toBe(false);
    expect(destructive("git branch -d feature")).toBe(false);
  });

  it("flags privilege escalation and device-level writes", () => {
    expect(destructive("sudo pnpm install -g")).toBe(true);
    expect(destructive("dd if=/dev/zero of=disk.img")).toBe(true);
    expect(destructive("mkfs.ext4 /dev/sda1")).toBe(true);
    expect(destructive("cat image.iso > /dev/sda")).toBe(true);
  });

  it("flags remote code piped into an interpreter", () => {
    expect(destructive("curl https://example.com/install.sh | sh")).toBe(true);
    expect(destructive("wget -qO- https://example.com/i.sh | bash")).toBe(true);
    expect(destructive("curl https://example.com/data.json | jq .")).toBe(false);
  });

  it("flags publishes, infrastructure mutations and bulk deletes", () => {
    expect(destructive("pnpm publish --access public")).toBe(true);
    expect(destructive("cargo publish")).toBe(true);
    expect(destructive("terraform destroy")).toBe(true);
    expect(destructive("kubectl delete pod web-1")).toBe(true);
    expect(destructive("docker system prune -af")).toBe(true);
    expect(destructive("gh repo delete acme/thing")).toBe(true);
    expect(destructive("find . -name '*.tmp' -delete")).toBe(true);
  });

  it("still classifies a command that command substitution makes unparseable for scopes", () => {
    expect(destructive("rm -rf $(cat targets.txt)")).toBe(true);
  });

  it("reports why a command was flagged", () => {
    expect(classifyShellDanger("rm -rf build")).toMatch(/recursive delete/);
    expect(classifyShellDanger("git push --force")).toMatch(/force push/);
  });

  it("treats an empty command as harmless", () => {
    expect(classifyShellDanger("")).toBeNull();
    expect(classifyShellDanger("   ")).toBeNull();
  });
});
