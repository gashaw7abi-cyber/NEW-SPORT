import http from 'http';

http.get('http://localhost:3000/api/news', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('STATUS:', res.statusCode, '\nBODY:', data.slice(0, 100)));
}).on('error', err => console.error(err.message));
