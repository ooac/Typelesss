const EN_PUNCTUATION_RULES: Array<[RegExp, string]> = [
  [/\btriple equals\b/gi, "==="],
  [/\bdouble equals\b/gi, "=="],
  [/\bfat arrow\b/gi, "=>"],
  [/\barrow\b/gi, "->"],
  [/\bnew line\b/gi, "\n"],
  [/\bfull stop\b/gi, "."],
  [/\bperiod\b/gi, "."],
  [/\bcomma\b/gi, ","],
  [/\bcolon\b/gi, ":"],
  [/\bsemicolon\b/gi, ";"],
  [/\bquestion mark\b/gi, "?"],
  [/\bexclamation mark\b/gi, "!"],
  [/\bopen paren\b/gi, "("],
  [/\bclose paren\b/gi, ")"],
  [/\bopen bracket\b/gi, "["],
  [/\bclose bracket\b/gi, "]"],
  [/\bopen brace\b/gi, "{"],
  [/\bclose brace\b/gi, "}"],
  [/\bbacktick\b/gi, "`"],
  [/\bbackslash\b/gi, "\\"],
  [/\bslash\b/gi, "/"],
  [/\bunderscore\b/gi, "_"],
  [/\b(?:dash|hyphen)\b/gi, "-"],
  [/\bequals\b/gi, "="],
];

const ZH_PUNCTUATION_RULES: Array<[RegExp, string]> = [
  [/换行/g, "\n"],
  [/逗号/g, "，"],
  [/句号/g, "。"],
  [/问号/g, "？"],
  [/感叹号/g, "！"],
  [/冒号/g, "："],
  [/分号/g, "；"],
  [/左括号/g, "（"],
  [/右括号/g, "）"],
  [/左引号/g, "“"],
  [/右引号/g, "”"],
  [/空格/g, " "],
];

export function applySpokenPunctuation(input: string): string {
  let text = input;

  for (const [pattern, replacement] of EN_PUNCTUATION_RULES) {
    text = text.replace(pattern, replacement);
  }

  for (const [pattern, replacement] of ZH_PUNCTUATION_RULES) {
    text = text.replace(pattern, replacement);
  }

  return text
    .replace(/[ \t]+([,.:;?!])/g, "$1")
    .replace(/([,.:;?!])(?=[A-Za-z0-9])/g, "$1 ")
    .replace(/[ \t]+([，。！？；：])/g, "$1")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function applyEnglishEmailGreetingLayout(input: string): string {
  return input.replace(
    /^(hello|hey)\s+([a-z][a-z'-]*),\s+(.+)$/i,
    (_match, greeting: string, name: string, body: string) =>
      `${capitalize(greeting)} ${capitalize(name)},\n\n${capitalizeFirstSentence(body)}`,
  );
}

export function capitalizeEnglishSentences(input: string): string {
  return input.replace(/(^|[.!?]\s+|\n+)([a-z])/g, (match, prefix: string, char: string) =>
    match.replace(prefix + char, prefix + char.toUpperCase()),
  );
}

export function capitalizeFirstSentence(input: string): string {
  return input.length === 0 ? input : input[0]!.toUpperCase() + input.slice(1);
}

function capitalize(input: string): string {
  return input.length === 0 ? input : input[0]!.toUpperCase() + input.slice(1).toLowerCase();
}
