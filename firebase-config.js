// Để null thì app chạy ở "chế độ máy" (dữ liệu lưu trong trình duyệt, chưa đồng bộ).
// Khoá apiKey của Firebase chỉ để nhận diện dự án; quyền truy cập do luật Firestore và đăng nhập Google quyết định.
export const firebaseConfig = {
  apiKey: "AIzaSyDc1WshVe1PFO6N-CCZt2kH8QgnytB3QBk",
  authDomain: "cong-viec-cua-thay.firebaseapp.com",
  projectId: "cong-viec-cua-thay",
  storageBucket: "cong-viec-cua-thay.firebasestorage.app",
  messagingSenderId: "501243625365",
  appId: "1:501243625365:web:e5563a7467659cf543c09c"
};
