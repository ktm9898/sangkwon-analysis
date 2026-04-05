const fetch = require('node-fetch');

async function test() {
  const url = 'https://openapi.naver.com/v1/search/local.json?query=' + encodeURIComponent('남영동 편의점') + '&display=5';
  const response = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': 'KOMV43YztpF2nsWry0Xz',
      'X-Naver-Client-Secret': 'VEZ_zQJkj8'
    }
  });
  const data = await response.json();
  console.log(JSON.stringify(data.items, null, 2));
}

test();
