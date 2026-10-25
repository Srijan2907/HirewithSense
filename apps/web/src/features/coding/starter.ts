import type { LanguageId } from '@hws/shared';

/** Fallback skeletons that read all of stdin, used when a problem has no starter code for the language. */
export const STARTER: Record<LanguageId, string> = {
  javascript: "// Read all input from stdin, print the answer to stdout.\nconst input = require('fs').readFileSync(0, 'utf8').trim();\nconst lines = input.split('\\n');\n\n// TODO: solve\nconsole.log(lines[0]);\n",
  typescript: "// Node runs this file directly (type-stripping). Read stdin, print stdout.\nimport { readFileSync } from 'node:fs';\nconst input: string = readFileSync(0, 'utf8').trim();\nconst lines = input.split('\\n');\n\n// TODO: solve\nconsole.log(lines[0]);\n",
  python: '# Read all input from stdin, print the answer to stdout.\nimport sys\n\ndef main() -> None:\n    data = sys.stdin.read().split()\n    # TODO: solve\n    print(data[0] if data else "")\n\nif __name__ == "__main__":\n    main()\n',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // TODO: solve\n    return 0;\n}\n',
  c: '#include <stdio.h>\n#include <stdlib.h>\n\nint main(void) {\n    // TODO: solve\n    return 0;\n}\n',
  java: 'import java.util.*;\nimport java.io.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));\n        // TODO: solve\n    }\n}\n',
  go: 'package main\n\nimport (\n\t"bufio"\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\treader := bufio.NewReader(os.Stdin)\n\t_ = reader\n\t// TODO: solve\n\tfmt.Println()\n}\n',
  rust: 'use std::io::{self, Read};\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n    // TODO: solve\n    println!("");\n}\n',
};
