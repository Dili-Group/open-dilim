// loader.ts — đọc SKILL.md từ filesystem, parse frontmatter, hiện thực progressive disclosure.
//
// Bootstrap gọi loadAllSkills(defsDir) 1 lần → nạp meta mọi skill vào registry. Body/references
// đọc lazy (readBody / readReference) chỉ khi worker/selector cần → context mặc định gọn.
//
// SKILL.md = untrusted (non-dev sửa): frontmatter thiếu/sai → throw ngay lúc load (fail fast ở
// bootstrap, không để lỗi trồi lên lúc chạy). Tên reference = untrusted → chặn path traversal.

import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import type { Skill, SkillMeta } from "./types.ts";

const SKILL_FILE = "SKILL.md";
const REFERENCES_DIR = "references";
const FRONTMATTER_DELIM = "---";
/** Khoá frontmatter bắt buộc — thiếu bất kỳ khoá nào → SKILL.md không hợp lệ. */
const REQUIRED_KEYS = ["name", "description", "version"] as const;

/** SKILL.md đã tách: frontmatter (meta) + phần body markdown còn lại. */
interface SkillDoc {
  readonly meta: SkillMeta;
  readonly body: string;
}

/**
 * Tách frontmatter YAML tối giản (chỉ `key: value` 1 dòng — đủ cho name/description/version,
 * không kéo lib YAML). `src` = nhãn để lỗi chỉ đúng file.
 */
function parseSkillDoc(raw: string, src: string): SkillDoc {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== FRONTMATTER_DELIM) {
    throw new Error(`${src}: thiếu frontmatter (phải mở đầu bằng "${FRONTMATTER_DELIM}").`);
  }

  // Tìm dòng "---" đóng frontmatter (bắt đầu từ dòng 1, sau dòng mở).
  const closeIdx = lines.findIndex((line, i) => i > 0 && line.trim() === FRONTMATTER_DELIM);
  if (closeIdx === -1) {
    throw new Error(`${src}: frontmatter không đóng (thiếu "${FRONTMATTER_DELIM}" thứ hai).`);
  }

  const fields = new Map<string, string>();
  for (const line of lines.slice(1, closeIdx)) {
    if (line.trim().length === 0) continue;
    const sep = line.indexOf(":");
    if (sep === -1) {
      throw new Error(`${src}: dòng frontmatter sai định dạng (cần "key: value"): ${line}`);
    }
    fields.set(line.slice(0, sep).trim(), line.slice(sep + 1).trim());
  }

  for (const key of REQUIRED_KEYS) {
    const value = fields.get(key);
    if (value === undefined || value.length === 0) {
      throw new Error(`${src}: frontmatter thiếu khoá bắt buộc "${key}".`);
    }
  }

  // Không dùng non-null "!": đã validate REQUIRED_KEYS ở trên nhưng narrow lại cho type-checker.
  const name = fields.get("name");
  const description = fields.get("description");
  const version = fields.get("version");
  if (name === undefined || description === undefined || version === undefined) {
    throw new Error(`${src}: frontmatter thiếu khoá bắt buộc.`);
  }

  return {
    meta: { name, description, version },
    body: lines.slice(closeIdx + 1).join("\n").trim(),
  };
}

/** Nạp 1 skill từ folder: đọc SKILL.md, parse frontmatter → meta. Body KHÔNG giữ (đọc lazy). */
export async function loadSkill(dir: string): Promise<Skill> {
  const file = join(dir, SKILL_FILE);
  const raw = await Bun.file(file).text();
  const { meta } = parseSkillDoc(raw, file);
  return { meta, dir };
}

/**
 * Quét defsDir: mỗi sub-folder có SKILL.md = 1 skill. Bỏ qua entry không phải folder / không có
 * SKILL.md (folder rác không làm sập bootstrap). Lỗi PARSE thì vẫn throw (skill hỏng ≠ vắng mặt).
 */
export async function loadAllSkills(defsDir: string): Promise<Skill[]> {
  const entries = await readdir(defsDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => join(defsDir, e.name));

  const withSkillFile = await Promise.all(
    dirs.map(async (dir) => ((await Bun.file(join(dir, SKILL_FILE)).exists()) ? dir : null)),
  );

  return Promise.all(withSkillFile.filter((dir): dir is string => dir !== null).map(loadSkill));
}

/** Body SKILL.md (phần sau frontmatter). Load KHI CẦN — không nằm ở context mặc định. */
export async function readBody(skill: Skill): Promise<string> {
  const file = join(skill.dir, SKILL_FILE);
  const { body } = parseSkillDoc(await Bun.file(file).text(), file);
  return body;
}

/** Liệt kê tên file trong references/ (progressive disclosure sâu hơn). [] nếu không có folder. */
export async function listReferences(skill: Skill): Promise<string[]> {
  const dir = join(skill.dir, REFERENCES_DIR);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    // ENOENT = skill không có references/ → rỗng, không phải lỗi. Lỗi khác thì rethrow.
    return [];
  }
}

/**
 * Đọc 1 file reference theo TÊN (basename). name = untrusted → chỉ nhận basename, chặn traversal
 * (`../`, path tuyệt đối) để không đọc ngoài folder skill.
 */
export async function readReference(skill: Skill, name: string): Promise<string> {
  if (name !== basename(name) || name.length === 0) {
    throw new Error(`Tên reference không hợp lệ (chỉ nhận basename): ${name}`);
  }
  return Bun.file(join(skill.dir, REFERENCES_DIR, name)).text();
}
