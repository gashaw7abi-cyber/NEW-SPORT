const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Replace webApp?.showAlert(...) with showCustomAlert(...)
content = content.replace(/webApp\?\.showAlert\((.*?)\);/g, 'showCustomAlert($1);');
content = content.replace(/webApp\.showAlert\((.*?)\);/g, 'showCustomAlert($1);');

// Replace if (webApp?.showAlert) { ... } else { alert(...) }
content = content.replace(/if\s*\(webApp\?\.showAlert\)\s*\{\s*showCustomAlert\((.*?)\);\s*\}\s*else\s*\{\s*alert\((.*?)\);\s*\}/g, 'showCustomAlert($1);');

fs.writeFileSync('src/App.tsx', content);
