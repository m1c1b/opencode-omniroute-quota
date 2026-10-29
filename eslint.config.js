import parser from "@typescript-eslint/parser"

export default [{
  files: ["**/*.ts", "**/*.tsx"],
  languageOptions: { parser },
  rules: { complexity: ["error", 10] },
}]
