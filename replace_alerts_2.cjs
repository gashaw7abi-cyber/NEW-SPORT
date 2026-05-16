const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Replace webApp?.showAlert(...) with setAlertMessage(...)
content = content.replace(/webApp\?\.showAlert\((.*?)\);/g, 'setAlertMessage($1);');
content = content.replace(/webApp\.showAlert\((.*?)\);/g, 'setAlertMessage($1);');

fs.writeFileSync('src/App.tsx', content);
