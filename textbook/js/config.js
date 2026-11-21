// 레몬트리 전자 교재 설정
//
// firebase 값이 비어 있으면 '체험 모드'로 동작합니다.
// 체험 모드는 이 기기의 브라우저에만 저장되는 시험용 데이터와 견본 교재를 씁니다.
// Firebase 프로젝트를 만든 뒤 콘솔의 '웹 앱' 설정값을 그대로 붙여 넣으면 실제 모드로 바뀝니다.

// 개발용: localhost에서 열면 언제나 체험 모드로 동작합니다.
const TEST_DEMO = typeof location !== 'undefined' && location.hostname === 'localhost';
// 화면 아래에 보이는 앱 버전. 고칠 때마다 sw.js의 VERSION과 함께 올린다.
export const APP_VERSION = '26';
export const config = {
  academyName: '레몬트리',

  // Firebase 콘솔 > 프로젝트 설정 > 내 앱 > SDK 설정 및 구성 > 'npm' 대신 'CDN' 아래의 firebaseConfig 값
  // appId는 이 앱이 쓰는 기능(로그인, 데이터베이스)에는 필요하지 않아 넣지 않았습니다.
  firebase: TEST_DEMO ? null : {
    apiKey: 'AIzaSyAlyunUbLr9y44wigkKwjXAZReCvG7BYsk',
    authDomain: 'lemontree-textbook.firebaseapp.com',
    projectId: 'lemontree-textbook',
    storageBucket: 'lemontree-textbook.firebasestorage.app',
    messagingSenderId: '157095058478',
  },
  // 예시:
  // firebase: TEST_DEMO ? null : {
  //   apiKey: 'AIza...',
  //   authDomain: 'lemontree-textbook.firebaseapp.com',
  //   projectId: 'lemontree-textbook',
  //   storageBucket: 'lemontree-textbook.appspot.com',
  //   messagingSenderId: '1234567890',
  //   appId: '1:1234567890:web:abcdef',
  // },

  // 구글 드라이브에서 PDF를 읽을 때 쓰는 API 키. 비워 두면 firebase.apiKey를 그대로 씁니다.
  driveApiKey: '',
};
