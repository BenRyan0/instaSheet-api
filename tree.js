const fs = require("fs");
const path = require("path");

const exclude = ["node_modules", "objects",".git",".vscode",".gitignore",".env","credentials.json","package-lock.json","package.json","Data", "tree.js"];


function printTree(dir, prefix = "") {
  const files = fs.readdirSync(dir);

  files.forEach((file, index) => {
    const filepath = path.join(dir, file);
    const isDir = fs.statSync(filepath).isDirectory();

    if (exclude.includes(file)) return;

    const isLast = index === files.length - 1;
    const connector = isLast ? "└── " : "├── ";

    console.log(prefix + connector + file);

    if (isDir) {
      const newPrefix = prefix + (isLast ? "    " : "│   ");
      printTree(filepath, newPrefix);
    } else if (file.endsWith(".js")) {
      try {
        const content = fs.readFileSync(filepath, "utf-8");

        // Capture exports like: module.exports = { foo, bar }
        let matches = content.match(/module\.exports\s*=\s*{([^}]*)}/s);

        if (matches) {
          const keys = matches[1]
            .split(",")
            .map(k => k.trim().split(":")[0].trim())
            .filter(k => k.length);

          keys.forEach((key, i) => {
            const subConnector = i === keys.length - 1 ? "└── " : "├── ";
            console.log(prefix + (isLast ? "    " : "│   ") + subConnector + key);
          });
        }

        // Capture exports.foo = ...
        let propMatches = [...content.matchAll(/exports\.(\w+)\s*=/g)];
        propMatches.forEach((m, i) => {
          const subConnector = i === propMatches.length - 1 ? "└── " : "├── ";
          console.log(prefix + (isLast ? "    " : "│   ") + subConnector + m[1]);
        });
      } catch (err) {
        console.log(prefix + (isLast ? "    " : "│   ") + "└── [error reading file]");
      }
    }
  });
}

printTree(process.cwd());
