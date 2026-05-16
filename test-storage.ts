import { initializeApp } from 'firebase/app';
import { getStorage, ref, uploadString } from 'firebase/storage';
import firebaseConfig from './firebase-applet-config.json';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);
const auth = getAuth(app);

async function run() {
    try {
        const storageRef = ref(storage, 'test.txt');
        await uploadString(storageRef, 'hello world');
        console.log("Storage upload successful");
    } catch (e) {
        console.error("Storage Error:", e);
    }
}
run();
