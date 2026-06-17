import React, { useState, useEffect } from 'react';
import { Trophy, Newspaper, ChevronRight, Lock, Plus, Trash2, LogOut, Upload, Users, Bell, BellOff, UserCircle, Save, Share2, Menu, X } from 'lucide-react';
import { auth, db, storage, getMessagingInstance } from './firebase';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User, updateProfile } from 'firebase/auth';
import { collection, query, orderBy, where, getDocs, addDoc, deleteDoc, doc, serverTimestamp, Timestamp, updateDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { getToken, onMessage } from 'firebase/messaging';
import ReactPlayer from 'react-player';
const Player = ReactPlayer as any;

// Error Handler helper
enum OperationType { CREATE = 'create', UPDATE = 'update', DELETE = 'delete', LIST = 'list', GET = 'get', WRITE = 'write' }

const showCustomAlert = (message: string) => {
  if (message.includes('aborted a request') || message.includes('AbortError')) {
    return;
  }
  try {
    const tg = (window as any).Telegram?.WebApp;
    if (tg && tg.isVersionAtLeast && tg.isVersionAtLeast('6.2') && tg.showAlert) {
      tg.showAlert(message);
    } else {
      alert(message);
    }
  } catch (e) {
    alert(message);
  }
};

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (errorMessage.includes('aborted a request') || errorMessage.includes('AbortError') || errorMessage.includes('Could not reach Cloud Firestore backend')) {
    return;
  }
  
  const errInfo = {
    error: errorMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  showCustomAlert(`Error: ${errInfo.error}\nCheck console for details.`);
  throw new Error(JSON.stringify(errInfo));
}

function App() {
  const [activeTab, setActiveTab] = useState<'news' | 'scores' | 'admin' | 'profile'>('news');
  const [news, setNews] = useState<any[]>([]);
  const [customNews, setCustomNews] = useState<any[]>([]);
  const [scores, setScores] = useState<any[]>([]);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [matchSummaries, setMatchSummaries] = useState<Record<string, any>>({});
  const [matchSummariesLoading, setMatchSummariesLoading] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Profile Form state
  const [profileName, setProfileName] = useState('');
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const [profileImagePreview, setProfileImagePreview] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);

  // Admin Form state
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [publishedDate, setPublishedDate] = useState('');
  const [isPublished, setIsPublished] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [adminStatusFilter, setAdminStatusFilter] = useState<'all' | 'published' | 'unpublished'>('all');
  const [scoreFilter, setScoreFilter] = useState<'all' | 'live' | 'upcoming' | 'completed'>('all');
  const [activeUsersCount, setActiveUsersCount] = useState<number>(0);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [fcmToken, setFcmToken] = useState<string | null>(null);

  useEffect(() => {
    // Check if permission is already granted
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        setPushEnabled(true);
      }
    } catch (e) {
      console.warn("Notifications not supported in this environment");
    }

    const setupMessaging = async () => {
      try {
        const messaging = await getMessagingInstance();
        if (messaging) {
          onMessage(messaging, (payload) => {
            console.log('Message received. ', payload);
            alert(`New Update: ${payload.notification?.title}\n${payload.notification?.body}`);
          });
        }
      } catch (e) {
        console.log('FCM not supported or configured on this browser.', e);
      }
    };
    setupMessaging();
  }, []);

  const handlePushOptIn = async () => {
    try {
      if (typeof Notification === 'undefined') {
        alert('Push notifications are not supported in this browser.');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setPushEnabled(true);
        const messaging = await getMessagingInstance();
        if (messaging && (import.meta as any).env.VITE_FIREBASE_VAPID_KEY) {
          const currentToken = await getToken(messaging, { vapidKey: (import.meta as any).env.VITE_FIREBASE_VAPID_KEY });
          if (currentToken) {
            setFcmToken(currentToken);
            // Save to DB
            try {
              await setDoc(doc(db, 'fcmTokens', currentToken), {
                token: currentToken,
                createdAt: serverTimestamp()
              });
              console.log('Token saved to DB');
            } catch (err) {
              console.error('Error saving token', err);
            }
          }
        } else {
          alert("Push notifications require VAPID key configuration in .env.");
        }
      }
    } catch (error) {
      console.error('Unable to get permission to notify.', error);
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        setProfileName(u.displayName || '');
        setProfileImagePreview(u.photoURL || null);
      } else {
        setProfileName('');
        setProfileImagePreview(null);
        if (activeTab === 'profile') setActiveTab('news');
      }
      setIsAdmin(u?.email === 'gashaw7abi@gmail.com' && !!u?.emailVerified);
    });
    return unsub;
  }, [activeTab]);

  // Track active sessions and update count
  useEffect(() => {
    let sessionId = null;
    try {
      sessionId = localStorage.getItem('sessionId');
      if (!sessionId) {
        sessionId = Math.random().toString(36).substring(2, 15);
        localStorage.setItem('sessionId', sessionId);
      }
    } catch (e) {
      console.warn("localStorage not supported or accessible", e);
      sessionId = Math.random().toString(36).substring(2, 15);
    }

    const updateSession = async () => {
      try {
        if (sessionId) {
          await setDoc(doc(db, 'sessions', sessionId), {
            lastActive: serverTimestamp()
          });
        }
      } catch (e) {
        console.error("Failed to update session", e);
      }
    };

    updateSession();
    const interval = setInterval(updateSession, 60000); // Heartbeat every 1 minute

    // Get total number of unique sessions
    const fetchTotalCount = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'sessions'));
        setActiveUsersCount(snapshot.size);
      } catch (e: any) {
        if (e.message !== 'Connection failed.') {
          console.error("Error fetching total sessions count", e);
        }
      }
    };

    fetchTotalCount();
    const countInterval = setInterval(fetchTotalCount, 60000); // Refresh every 1 minute

    return () => {
      clearInterval(interval);
      clearInterval(countInterval);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    fetchData(() => !isMounted);
    return () => { isMounted = false; };
  }, [activeTab, isAdmin, adminStatusFilter, scoreFilter]);

  const fetchData = async (checkAborted?: () => boolean) => {
    setLoading(true);
    try {
      if (activeTab === 'news') {
        const res = await fetch('/api/news');
        if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
        const data = await res.json();
        if (checkAborted && checkAborted()) return;
        const newsArray = Array.isArray(data) ? data : [];
        newsArray.sort((a: any, b: any) => new Date(b.published || 0).getTime() - new Date(a.published || 0).getTime());
        setNews(newsArray);
        
        // Fetch custom news
        try {
          const q = query(collection(db, 'customNews'), where('published', '==', true));
          const snapshot = await getDocs(q);
          if (checkAborted && checkAborted()) return;
          const customData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          customData.sort((a: any, b: any) => {
             const timeA = a.publishedAt?.seconds 
               ? a.publishedAt.seconds * 1000 
               : typeof a.publishedAt === 'number' ? a.publishedAt : 0;
             const timeB = b.publishedAt?.seconds 
               ? b.publishedAt.seconds * 1000 
               : typeof b.publishedAt === 'number' ? b.publishedAt : 0;
             return timeB - timeA;
          });
          setCustomNews(customData);
        } catch (e) {
          handleFirestoreError(e, OperationType.LIST, 'customNews');
        }
      } else if (activeTab === 'scores') {
        const res = await fetch('/api/scores');
        if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
        const data = await res.json();
        if (checkAborted && checkAborted()) return;
        let scoresData = Array.isArray(data) ? data : [];
        
        // Apply filters
        if (scoreFilter === 'live') {
          scoresData = scoresData.filter(s => s.status?.type?.state === 'in');
        } else if (scoreFilter === 'upcoming') {
          scoresData = scoresData.filter(s => s.status?.type?.state === 'pre');
        } else if (scoreFilter === 'completed') {
          scoresData = scoresData.filter(s => s.status?.type?.state === 'post');
        }

        const now = Date.now();
        scoresData.sort((a, b) => {
          const stateA = a.status?.type?.state;
          const stateB = b.status?.type?.state;
          // Live games first
          if (stateA === 'in' && stateB !== 'in') return -1;
          if (stateB === 'in' && stateA !== 'in') return 1;
          
          // Then by closest to current time
          const diffA = Math.abs(now - new Date(a.date).getTime());
          const diffB = Math.abs(now - new Date(b.date).getTime());
          return diffA - diffB;
        });
        setScores(scoresData);
      } else if (activeTab === 'admin') {
        if (isAdmin) {
          try {
            let qRef = collection(db, 'customNews');
            let qQuery = query(qRef);
            if (adminStatusFilter === 'published') {
              qQuery = query(qRef, where('published', '==', true));
            } else if (adminStatusFilter === 'unpublished') {
              qQuery = query(qRef, where('published', '==', false));
            }
            const snapshot = await getDocs(qQuery);
            if (checkAborted && checkAborted()) return;
            const customData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            customData.sort((a: any, b: any) => {
               const timeA = a.publishedAt?.seconds 
                 ? a.publishedAt.seconds * 1000 
                 : typeof a.publishedAt === 'number' ? a.publishedAt : 0;
               const timeB = b.publishedAt?.seconds 
                 ? b.publishedAt.seconds * 1000 
                 : typeof b.publishedAt === 'number' ? b.publishedAt : 0;
               return timeB - timeA;
            });
            setCustomNews(customData);
          } catch(e) {
            handleFirestoreError(e, OperationType.LIST, 'customNews');
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError' && !err.message?.includes('aborted a request') && !err.message?.includes('Failed to fetch')) {
        console.error('Fetch data error:', err);
      }
      if (activeTab === 'news') setNews([]);
      if (activeTab === 'scores') setScores([]);
      // You could display a UI error message if desired
    } finally {
      if (!checkAborted || !checkAborted()) {
        setLoading(false);
      }
    }
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login error', error);
      showCustomAlert('Login failed');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setActiveTab('news');
    } catch (error) {
      console.error('Logout error', error);
    }
  };

  const handleProfilePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setProfilePhoto(file);
      setProfileImagePreview(URL.createObjectURL(file));
    }
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setProfileSaving(true);
    try {
      let finalPhotoUrl = user.photoURL;

      if (profilePhoto) {
        const fileRef = ref(storage, `profiles/${user.uid}/${Date.now()}_${profilePhoto.name}`);
        const uploadTask = uploadBytesResumable(fileRef, profilePhoto);
        await uploadTask;
        finalPhotoUrl = await getDownloadURL(fileRef);
      }

      await updateProfile(user, {
        displayName: profileName,
        photoURL: finalPhotoUrl
      });
      
      setUser({...user, displayName: profileName, photoURL: finalPhotoUrl} as User);
      showCustomAlert('Profile updated successfully!');
    } catch (err: any) {
      console.error('Profile update error', err);
      showCustomAlert(`Error: ${err.message}`);
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePostNews = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !user) return;
    setPublishing(true);
    setUploadProgress(0);

    let finalImageUrl = imageUrl || null;
    let finalVideoUrl = videoUrl || null;

    try {
      if (mediaFile) {
        const isVideo = mediaFile.type.startsWith('video/');
        const fileRef = ref(storage, `customNews_media/${Date.now()}_${mediaFile.name}`);
        const uploadTask = uploadBytesResumable(fileRef, mediaFile);

        await new Promise<void>((resolve, reject) => {
          uploadTask.on('state_changed', 
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(progress);
            },
            (error) => {
               console.error("Storage upload error", error);
               if (error.code === 'storage/unknown' || error.message.includes('permission')) {
                 showCustomAlert("ፋይል መጫን አልተሳካም። እባክዎ Firebase Console ውስጥ Storage enable መሆኑን ያረጋግጡ።\n\nError: " + error.message);
                 reject(error);
               } else {
                 reject(error);
               }
            },
            async () => {
              try {
                const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                if (isVideo) {
                  finalVideoUrl = downloadUrl;
                } else {
                  finalImageUrl = downloadUrl;
                }
                resolve();
              } catch (e) {
                reject(e);
              }
            }
          );
        });
      }

      let publishedTimestamp: any = serverTimestamp();
      if (publishedDate) {
        const dateObj = new Date(publishedDate);
        if (!isNaN(dateObj.getTime())) {
          publishedTimestamp = Timestamp.fromDate(dateObj);
        }
      }

      await addDoc(collection(db, 'customNews'), {
        headline,
        description,
        ...(finalImageUrl && { imageUrl: finalImageUrl }),
        ...(finalVideoUrl && { videoUrl: finalVideoUrl }),
        publishedAt: publishedTimestamp,
        authorEmail: user.email,
        published: isPublished
      });
      setHeadline('');
      setDescription('');
      setImageUrl('');
      setVideoUrl('');
      setIsPublished(true);
      setMediaFile(null);
      setUploadProgress(0);
      setPublishedDate('');
      fetchData(); // refresh list
      showCustomAlert("News posted successfully!");
    } catch (error: any) {
      if (error?.code?.startsWith('storage/')) {
        // Storage errors already alerted in the upload flow, don't trigger firestore errors
      } else {
        handleFirestoreError(error, OperationType.CREATE, 'customNews');
      }
    } finally {
      setPublishing(false);
      setUploadProgress(0);
    }
  };

  const handleDeleteNews = async (id: string) => {
    if (!isAdmin || !confirm("Delete this news post?")) return;
    try {
      await deleteDoc(doc(db, 'customNews', id));
      fetchData();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `customNews/${id}`);
    }
  };

  const handleTogglePublished = async (id: string, currentStatus: boolean) => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, 'customNews', id), {
        published: !currentStatus
      });
      fetchData();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `customNews/${id}`);
    }
  };

  const handleShare = async (e: React.MouseEvent, title: string, text: string, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (navigator.share) {
        await navigator.share({
          title,
          text,
          url
        });
      } else {
        await navigator.clipboard.writeText(`${title}\n\n${text}\n\n${url}`);
        showCustomAlert("News copied to clipboard!");
      }
    } catch (err) {
      console.log('Error sharing', err);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans pb-24">
      {/* Header */}
      <header className="bg-[#1e293b] border-b border-slate-700/50 sticky top-0 z-50 shadow-lg relative">
        <div className="px-5 py-4 max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full overflow-hidden shadow-lg shadow-emerald-500/20 bg-emerald-500">
              <img src="https://i.postimg.cc/g29Gpg7r/1778746810882.jpg" alt="NEW SPORT Logo" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-xl font-black italic tracking-wider text-white leading-tight">NEW SPORT</h1>
              <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Live Updates & News</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full" title="Total Visitors">
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-bold text-emerald-400">{activeUsersCount}</span>
              </div>
            )}
            <button 
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-2 -mr-2 text-slate-400 hover:text-emerald-400 transition-colors"
            >
              {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
        
        {/* Dropdown Menu */}
        {isMenuOpen && (
          <div className="absolute top-full left-0 right-0 bg-[#1e293b] border-b border-slate-700/50 shadow-2xl z-40">
            <div className="max-w-md mx-auto p-4 flex flex-col gap-2">
              <button 
                onClick={() => { setActiveTab('news'); setIsMenuOpen(false); }}
                className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
                  activeTab === 'news' 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <Newspaper className="w-5 h-5" />
                <span className="font-bold uppercase tracking-widest text-sm">News</span>
              </button>
              <button 
                onClick={() => { setActiveTab('scores'); setIsMenuOpen(false); }}
                className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
                  activeTab === 'scores' 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <Trophy className="w-5 h-5" />
                <span className="font-bold uppercase tracking-widest text-sm">Scores</span>
              </button>
              <div className="h-px bg-slate-700/50 my-2"></div>
              
              <button 
                onClick={() => { handlePushOptIn(); setIsMenuOpen(false); }}
                className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
                  pushEnabled 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {pushEnabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
                <span className="font-bold uppercase tracking-widest text-sm">Notifications</span>
              </button>
              
              {!user ? (
                 <button 
                   onClick={() => { handleLogin(); setIsMenuOpen(false); }} 
                   className="flex items-center gap-3 p-3 rounded-xl transition-all text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                 >
                   <Lock className="w-5 h-5" />
                   <span className="font-bold uppercase tracking-widest text-sm">Admin Login</span>
                 </button>
              ) : (
                 <>
                   {isAdmin && (
                     <button 
                       onClick={() => { setActiveTab('admin'); setIsMenuOpen(false); }} 
                       className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
                         activeTab === 'admin' 
                           ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                           : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                       }`}
                     >
                       <Lock className="w-5 h-5" />
                       <span className="font-bold uppercase tracking-widest text-sm">Admin Panel</span>
                     </button>
                   )}
                   <button 
                     onClick={() => { setActiveTab('profile'); setIsMenuOpen(false); }}
                     className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
                       activeTab === 'profile' 
                         ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                         : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                     }`}
                   >
                     <UserCircle className="w-5 h-5" />
                     <span className="font-bold uppercase tracking-widest text-sm">Profile</span>
                   </button>
                   <button 
                     onClick={() => { handleLogout(); setIsMenuOpen(false); }} 
                     className="flex items-center gap-3 p-3 rounded-xl transition-all text-red-500 hover:bg-red-500/10"
                   >
                     <LogOut className="w-5 h-5" />
                     <span className="font-bold uppercase tracking-widest text-sm">Logout</span>
                   </button>
                 </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="p-4 max-w-md mx-auto space-y-6 mt-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 animate-pulse">Loading data...</p>
          </div>
        ) : activeTab === 'admin' && isAdmin ? (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-400" />
              Post New Update
            </h2>
            <form onSubmit={handlePostNews} className="space-y-4 bg-[#1e293b] p-5 rounded-2xl border border-slate-700/50">
               <div>
                 <label className="text-xs font-bold uppercase tracking-widest text-slate-400 block mb-2">Headline</label>
                 <input 
                   required 
                   maxLength={300}
                   value={headline}
                   onChange={e => setHeadline(e.target.value)}
                   className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white focus:border-emerald-500 focus:outline-none" 
                   placeholder="Match result, breaking news..." 
                 />
               </div>
               <div>
                 <label className="text-xs font-bold uppercase tracking-widest text-slate-400 block mb-2">Description</label>
                 <textarea 
                   required
                   maxLength={20000}
                   value={description}
                   onChange={e => setDescription(e.target.value)}
                   className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white focus:border-emerald-500 focus:outline-none min-h-[100px]" 
                   placeholder="Details here..." 
                 />
               </div>
               <div>
                 <label className="text-xs font-bold uppercase tracking-widest text-slate-400 block mb-2">Media File (Photo/Video)</label>
                 <label className="w-full bg-slate-800 border border-slate-700 hover:border-emerald-500 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition-colors">
                   <Upload className="w-6 h-6 text-slate-400 mb-2" />
                   <span className="text-sm text-slate-400">{mediaFile ? mediaFile.name : "ምስል ወይም ቪዲዮ ይምረጡ"}</span>
                   <input 
                     type="file" 
                     className="hidden" 
                     accept="image/*,video/*"
                     onChange={e => {
                       if (e.target.files?.[0]) setMediaFile(e.target.files[0]);
                     }}
                   />
                 </label>
                 {uploadProgress > 0 && uploadProgress < 100 && (
                   <div className="w-full bg-slate-700 h-2 mt-3 rounded-full overflow-hidden">
                     <div className="bg-emerald-500 h-full transition-all" style={{ width: `${uploadProgress}%` }} />
                   </div>
                 )}
               </div>
               <div className="text-center text-xs text-slate-500 my-2">ወይም ሊንክ ያስገቡ</div>
               <div className="flex gap-2">
                 <div className="flex-1">
                   <label className="text-xs font-bold uppercase tracking-widest text-slate-400 block mb-2">Image URL</label>
                   <input 
                     type="url"
                     value={imageUrl}
                     onChange={e => setImageUrl(e.target.value)}
                     className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white focus:border-emerald-500 focus:outline-none text-sm" 
                     placeholder="Image link..." 
                   />
                 </div>
                 <div className="flex-1">
                   <label className="text-xs font-bold uppercase tracking-widest text-slate-400 block mb-2">Video URL</label>
                   <input 
                     type="url"
                     value={videoUrl}
                     onChange={e => setVideoUrl(e.target.value)}
                     className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white focus:border-emerald-500 focus:outline-none text-sm" 
                     placeholder="Video link..." 
                   />
                 </div>
               </div>
               <div>
                 <label className="text-xs font-bold uppercase tracking-widest text-slate-400 block mb-2">Publish Date (Optional)</label>
                 <input 
                   type="datetime-local"
                   value={publishedDate}
                   onChange={e => setPublishedDate(e.target.value)}
                   className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white focus:border-emerald-500 focus:outline-none" 
                 />
               </div>
               <button 
                 type="submit" 
                 disabled={publishing}
                 className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold py-3 rounded-xl transition-colors disabled:opacity-50"
               >
                 {publishing ? 'Publishing...' : 'Publish Post'}
               </button>
            </form>

            <div className="flex items-center justify-between mb-4 mt-8">
               <h3 className="text-md font-bold text-white">Manage Existing Posts</h3>
               <select 
                 value={adminStatusFilter}
                 onChange={(e) => setAdminStatusFilter(e.target.value as any)}
                 className="bg-slate-800 border border-slate-700 text-sm rounded-lg p-2 text-white focus:outline-none focus:border-emerald-500"
               >
                 <option value="all">All</option>
                 <option value="published">Published</option>
                 <option value="unpublished">Drafts</option>
               </select>
            </div>
            <div className="space-y-4">
              {customNews.map((item, i) => (
                <div key={item.id} className="bg-[#1e293b] rounded-xl p-4 border border-slate-700/50 flex justify-between items-center">
                  <div>
                    <div className="flex items-center mb-1">
                      <h4 className="font-bold text-white text-sm">{item.headline}</h4>
                      <span className={`text-[10px] uppercase font-bold tracking-widest ml-2 px-2 py-0.5 rounded-full ${item.published ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-300'}`}>
                        {item.published ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500">{new Date(item.publishedAt?.seconds ? item.publishedAt.seconds * 1000 : (item.publishedAt || Date.now())).toLocaleDateString()}</span>
                   </div>
                   <div className="flex items-center gap-2">
                     <button 
                       onClick={() => handleTogglePublished(item.id, item.published)} 
                       className={`px-3 py-1 text-[10px] uppercase font-bold tracking-widest rounded-full transition-colors ${item.published ? 'bg-slate-700 hover:bg-slate-600 text-slate-300' : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400'}`}
                     >
                       {item.published ? 'Draft' : 'Publish'}
                     </button>
                     <button onClick={() => handleDeleteNews(item.id)} className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors">
                       <Trash2 className="w-4 h-4" />
                     </button>
                   </div>
                </div>
              ))}
            </div>
          </div>
        ) : activeTab === 'news' ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-emerald-400" />
                Latest Headlines
              </h2>
            </div>
            
            {news.length === 0 && customNews.length === 0 && (
              <div className="bg-[#1e293b] rounded-2xl p-8 text-center border border-slate-700/50">
                <p className="text-slate-400 text-sm">No recent news available.</p>
              </div>
            )}
            
            <div className="space-y-4">
              {(() => {
                const combinedNews = [
                  ...customNews.map(item => ({
                    ...item, 
                    isCustomItem: true, 
                    sortTime: new Date(item.publishedAt?.seconds ? item.publishedAt.seconds * 1000 : (item.publishedAt || Date.now())).getTime() 
                  })),
                  ...news.map(item => ({
                    ...item, 
                    isCustomItem: false, 
                    sortTime: new Date(item.published || 0).getTime() 
                  }))
                ].sort((a, b) => b.sortTime - a.sortTime);

                return combinedNews.map((item, i) => {
                  if (item.isCustomItem) {
                    return (
                      <div 
                        key={`custom-${item.id}`} 
                        className="block bg-gradient-to-br from-emerald-900/40 to-[#1e293b] rounded-[2rem] overflow-hidden border border-emerald-500/30 hover:border-emerald-500/60 transition-all shadow-xl shadow-emerald-900/20 group"
                      >
                        {item.videoUrl ? (
                          <div className="relative h-56 w-full overflow-hidden bg-black">
                             <Player
                               url={item.videoUrl}
                               controls
                               width="100%"
                               height="100%"
                             />
                          </div>
                        ) : item.imageUrl ? (
                          <div className="relative h-56 overflow-hidden bg-slate-800">
                            <img 
                              src={item.imageUrl} 
                              alt="" 
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-[#1e293b] to-transparent opacity-80" />
                          </div>
                        ) : null}
                        <div className="p-6 relative">
                          <div className="mb-3">
                            <span className="text-[10px] font-black uppercase tracking-widest text-[#1e293b] bg-emerald-400 px-3 py-1.5 rounded-full">
                              Admin Update
                            </span>
                          </div>
                          <h3 className="text-lg font-bold text-white mb-3 leading-snug group-hover:text-emerald-400 transition-colors">
                            {item.headline}
                          </h3>
                          <p className="text-sm text-slate-300 line-clamp-3 leading-relaxed whitespace-pre-wrap">
                            {item.description}
                          </p>
                          <div className="mt-6 flex items-center justify-between text-xs font-bold uppercase tracking-wider">
                            <span className="text-slate-500">{new Date(item.publishedAt?.seconds ? item.publishedAt.seconds * 1000 : (item.publishedAt || Date.now())).toLocaleDateString()}</span>
                            <button
                              onClick={(e) => handleShare(e, item.headline, item.description, window.location.origin)}
                              className="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-400 flex items-center justify-center transition-colors"
                              title="Share"
                            >
                              <Share2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  } else {
                    return (
                      <div 
                        key={`api-${i}`} 
                        className="block bg-[#1e293b] rounded-[2rem] overflow-hidden border border-slate-700/50 hover:border-emerald-500/50 transition-all hover:shadow-xl hover:shadow-emerald-500/10 group"
                      >
                        {item.images?.[0]?.url && (
                          <div className="relative h-56 overflow-hidden bg-slate-800">
                            <img 
                              src={item.images[0].url} 
                              alt="" 
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-[#1e293b] to-transparent opacity-80" />
                          </div>
                        )}
                        <div className="p-6 relative">
                          <div className="mb-3 flex gap-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-full">
                              Football
                            </span>
                          </div>
                          <h3 className="text-lg font-bold text-white mb-3 leading-snug group-hover:text-emerald-400 transition-colors">
                            {item.headline}
                          </h3>
                          <p className="text-sm text-slate-400 line-clamp-3 leading-relaxed">
                            {item.description}
                          </p>
                          <div className="mt-6 flex items-center justify-between text-xs font-bold uppercase tracking-wider">
                            <span className="text-slate-500">{new Date(item.published).toLocaleDateString()}</span>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={(e) => handleShare(e, item.headline, item.description, window.location.origin)}
                                className="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-400 flex items-center justify-center transition-colors"
                                title="Share"
                              >
                                <Share2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }
                });
              })()}
            </div>
          </div>
        ) : activeTab === 'profile' ? (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <UserCircle className="w-5 h-5 text-emerald-400" />
              Your Profile
            </h2>
            <div className="bg-[#1e293b] p-6 rounded-3xl border border-slate-700/50">
              <form onSubmit={handleProfileSave} className="space-y-6">
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <div className="w-24 h-24 rounded-full overflow-hidden bg-slate-800 border-2 border-slate-700">
                      {profileImagePreview ? (
                        <img src={profileImagePreview} alt="Profile preview" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <UserCircle className="w-12 h-12 text-slate-500" />
                        </div>
                      )}
                    </div>
                    <label className="absolute bottom-0 right-0 p-1.5 bg-emerald-500 rounded-full cursor-pointer hover:bg-emerald-400 transition-colors shadow-lg">
                      <Upload className="w-4 h-4 text-white" />
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={handleProfilePhotoChange}
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Display Name</label>
                  <input
                    type="text"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="w-full bg-[#0f172a] border border-slate-700 rounded-xl px-4 py-3 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-medium"
                    placeholder="Enter your name"
                  />
                </div>

                <button
                  type="submit"
                  disabled={profileSaving}
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-[#0f172a] font-black uppercase tracking-widest text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  {profileSaving ? 'Saving...' : 'Save Profile'}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  Live & Recent Matches
                </h2>
              </div>
              <div className="flex gap-1 bg-[#1e293b] p-1 rounded-2xl border border-slate-700/50">
                {(['all', 'live', 'upcoming', 'completed'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setScoreFilter(f)}
                    className={`flex-1 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      scoreFilter === f 
                        ? 'bg-emerald-500 text-[#1e293b]' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {scores.length === 0 && (
              <div className="bg-[#1e293b] rounded-2xl p-8 text-center border border-slate-700/50">
                <p className="text-slate-400 text-sm">No match scores available at the moment.</p>
              </div>
            )}
            
            <div className="space-y-4">
              {scores.map((match, i) => {
                if (!match?.competitions?.[0]?.competitors) return null;
                const homeTeam = match.competitions[0].competitors.find((c: any) => c.homeAway === 'home');
                const awayTeam = match.competitions[0].competitors.find((c: any) => c.homeAway === 'away');
                if (!homeTeam || !awayTeam) return null;
                const status = match.status?.type?.shortDetail || 'TBD';
                const matchState = match.status?.type?.state; // 'pre', 'in', 'post'
                const matchId = match.id;
                const isExpanded = expandedMatchId === matchId;
                const toggleExpand = async () => {
                  if (isExpanded) {
                    setExpandedMatchId(null);
                  } else {
                    setExpandedMatchId(matchId);
                    if (!matchSummaries[matchId] && !matchSummariesLoading[matchId] && match._league) {
                      setMatchSummariesLoading(prev => ({ ...prev, [matchId]: true }));
                      try {
                        const res = await fetch(`/api/summary?league=${match._league}&event=${matchId}`);
                        if (res.ok) {
                          const data = await res.json();
                          setMatchSummaries(prev => ({ ...prev, [matchId]: data }));
                        }
                      } catch (err) {
                        console.error('Failed to fetch summary', err);
                      } finally {
                        setMatchSummariesLoading(prev => ({ ...prev, [matchId]: false }));
                      }
                    }
                  }
                };

                const isLive = matchState === 'in';
                const isPre = matchState === 'pre';
                const displayStatus = isLive ? `LIVE ${match.status?.displayClock ? `- ${match.status.displayClock}` : ''}` : status;
                
                const summaryData = matchSummaries[matchId];
                
                // Use summaryData for more accurate stats if available
                const homeBoxscore = summaryData?.boxscore?.teams?.find((t: any) => t.team?.id === homeTeam.team?.id)?.statistics;
                const awayBoxscore = summaryData?.boxscore?.teams?.find((t: any) => t.team?.id === awayTeam.team?.id)?.statistics;

                const getStat = (source1: any[], source2: any[] | undefined, name: string) => {
                  return source2?.find(s => s.name === name)?.displayValue || source1?.find(s => s.name === name)?.displayValue;
                };

                const homePossession = getStat(homeTeam.statistics || [], homeBoxscore, 'possessionPct');
                const awayPossession = getStat(awayTeam.statistics || [], awayBoxscore, 'possessionPct');

                const homeShotsOnTarget = parseInt(getStat(homeTeam.statistics || [], homeBoxscore, 'shotsOnTarget') || '0', 10);
                const awayShotsOnTarget = parseInt(getStat(awayTeam.statistics || [], awayBoxscore, 'shotsOnTarget') || '0', 10);

                const homeTotalShots = parseInt(getStat(homeTeam.statistics || [], homeBoxscore, 'totalShots') || '0', 10);
                const awayTotalShots = parseInt(getStat(awayTeam.statistics || [], awayBoxscore, 'totalShots') || '0', 10);

                const homeBlockedShots = parseInt(homeBoxscore?.find((s: any) => s.name === 'blockedShots')?.displayValue || '0', 10);
                const awayBlockedShots = parseInt(awayBoxscore?.find((s: any) => s.name === 'blockedShots')?.displayValue || '0', 10);

                // Shots Off Target = Total Shots - Shots On Target - Blocked Shots (approx if blockedShots is missing, but better when summary is loaded)
                const homeShotsOffTarget = summaryData ? Math.max(0, homeTotalShots - homeShotsOnTarget - homeBlockedShots) : Math.max(0, homeTotalShots - homeShotsOnTarget);
                const awayShotsOffTarget = summaryData ? Math.max(0, awayTotalShots - awayShotsOnTarget - awayBlockedShots) : Math.max(0, awayTotalShots - awayShotsOnTarget);
                
                const goals = match.competitions[0].details?.filter((d: any) => d.scoringPlay) || [];
                const homeGoals = goals.filter((g: any) => g.team?.id === homeTeam.team?.id);
                const awayGoals = goals.filter((g: any) => g.team?.id === awayTeam.team?.id);
                
                return (
                  <div key={i} onClick={toggleExpand} className="bg-[#1e293b] rounded-3xl p-5 border border-slate-700/50 shadow-lg relative overflow-hidden cursor-pointer transition-colors hover:bg-slate-800">
                    {/* Live indicator glow */}
                    {isLive && (
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,1)]" />
                    )}

                    <div className="flex justify-between items-center mb-6">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{new Date(match.date).toLocaleDateString()}</span>
                      <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full ${isLive ? 'bg-red-500/20 text-red-500 animate-pulse' : 'bg-slate-800 text-emerald-400'}`}>
                        {displayStatus}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      {/* Home Team */}
                      <div className="flex flex-col items-center flex-1 w-1/3">
                        <div className="w-14 h-14 bg-white rounded-2xl p-2 mb-3 shadow-md flex items-center justify-center">
                          <img src={homeTeam.team.logo} alt={homeTeam.team.name} className="w-full h-full object-contain" />
                        </div>
                        <span className="text-xs font-bold text-center text-white leading-tight">{homeTeam.team.shortDisplayName}</span>
                      </div>
                      
                      {/* Score Display */}
                      <div className="flex flex-col items-center justify-center px-4 w-1/3">
                        {isPre ? (
                          <div className="flex flex-col items-center justify-center">
                            <span className="text-xl font-bold text-white mb-1">vs</span>
                            <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md">
                              {new Date(match.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ) : (
                          <div className="text-4xl font-black text-white tracking-tighter flex items-center gap-3">
                            <span className={homeTeam.winner ? 'text-emerald-400' : ''}>{homeTeam.score || '0'}</span>
                            <span className="text-slate-600 font-normal opacity-50">-</span>
                            <span className={awayTeam.winner ? 'text-emerald-400' : ''}>{awayTeam.score || '0'}</span>
                          </div>
                        )}
                      </div>

                      {/* Away Team */}
                      <div className="flex flex-col items-center flex-1 w-1/3">
                        <div className="w-14 h-14 bg-white rounded-2xl p-2 mb-3 shadow-md flex items-center justify-center">
                          <img src={awayTeam.team.logo} alt={awayTeam.team.name} className="w-full h-full object-contain" />
                        </div>
                        <span className="text-xs font-bold text-center text-white leading-tight">{awayTeam.team.shortDisplayName}</span>
                      </div>
                    </div>

                    {isExpanded && !isPre && (
                      <div className="mt-6 pt-4 border-t border-slate-700/50 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        {/* Stats */}
                        {(homePossession || awayPossession || homeTotalShots > 0 || awayTotalShots > 0) && (
                          <div className="space-y-4 mb-4">
                            {/* Possession */}
                            {(homePossession || awayPossession) && (
                              <div className="space-y-1">
                                <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">
                                  <span>{homePossession}%</span>
                                  <span>Possession</span>
                                  <span>{awayPossession}%</span>
                                </div>
                                <div className="flex h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                  <div className="bg-emerald-500 transition-all duration-1000" style={{ width: `${parseFloat(homePossession) || 50}%` }} />
                                  <div className="bg-slate-600 transition-all duration-1000" style={{ width: `${parseFloat(awayPossession) || 50}%` }} />
                                </div>
                              </div>
                            )}

                            {/* Shots on Target */}
                            {(homeShotsOnTarget > 0 || awayShotsOnTarget > 0) && (
                              <div className="space-y-1">
                                <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">
                                  <span>{homeShotsOnTarget}</span>
                                  <span>Shots on target</span>
                                  <span>{awayShotsOnTarget}</span>
                                </div>
                                <div className="flex h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                  <div className="bg-emerald-500 transition-all duration-1000" style={{ width: `${(homeShotsOnTarget / (homeShotsOnTarget + awayShotsOnTarget)) * 100}%` }} />
                                  <div className="bg-slate-600 transition-all duration-1000" style={{ width: `${(awayShotsOnTarget / (homeShotsOnTarget + awayShotsOnTarget)) * 100}%` }} />
                                </div>
                              </div>
                            )}

                            {/* Shots off Target */}
                            {(homeShotsOffTarget > 0 || awayShotsOffTarget > 0) && (
                              <div className="space-y-1">
                                <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">
                                  <span>{homeShotsOffTarget}</span>
                                  <span>Shots off target</span>
                                  <span>{awayShotsOffTarget}</span>
                                </div>
                                <div className="flex h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                  <div className="bg-emerald-500 transition-all duration-1000" style={{ width: `${(homeShotsOffTarget / (homeShotsOffTarget + awayShotsOffTarget)) * 100}%` }} />
                                  <div className="bg-slate-600 transition-all duration-1000" style={{ width: `${(awayShotsOffTarget / (homeShotsOffTarget + awayShotsOffTarget)) * 100}%` }} />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* Match Events Timeline */}
                        {(() => {
                          const summaryData = matchSummaries[matchId];
                          let eventsToRender: any[] = [];
                          
                          if (summaryData?.keyEvents) {
                            eventsToRender = summaryData.keyEvents.filter((e: any) => 
                              e.type?.text && !['Kickoff', 'Halftime', 'Start 2nd Half', 'End Regular Time', 'End period', 'End Match', 'Match starts'].includes(e.type.text)
                            );
                          } else if (goals.length > 0) {
                            // Fallback to details if summary not loaded or not available yet
                            eventsToRender = match.competitions[0].details || [];
                          }

                          if (matchSummariesLoading[matchId]) {
                            return (
                              <div className="flex justify-center py-4">
                                <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                              </div>
                            );
                          }

                          if (eventsToRender.length === 0) {
                            return !homePossession && !awayPossession ? (
                              <div className="text-center text-xs text-slate-500 py-2">
                                Detailed stats and events not available yet.
                              </div>
                            ) : null;
                          }

                          return (
                            <div className="pt-2">
                              <h4 className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-4 text-center">Match Events</h4>
                              <div className="space-y-4">
                                {eventsToRender.map((event: any, ei: number) => {
                                  const isHome = event.team?.id === homeTeam.team?.id;
                                  const typeText = event.type?.text || '';
                                  const isGoal = typeText.includes('Goal') || typeText.includes('Penalty - Scored');
                                  const isYellow = typeText.includes('Yellow Card');
                                  const isRed = typeText.includes('Red Card');
                                  const isSub = typeText.includes('Substitution');
                                  const isInjury = typeText.includes('injury') || (event.text && event.text.includes('injury'));
                                  
                                  let icon = null;
                                  if (isGoal) {
                                    icon = <span className="text-[10px]">⚽</span>;
                                  } else if (isYellow) {
                                    icon = <div className="w-2.5 h-3.5 bg-yellow-400 rounded-sm shadow-sm" />;
                                  } else if (isRed) {
                                    icon = <div className="w-2.5 h-3.5 bg-red-500 rounded-sm shadow-sm" />;
                                  } else if (isSub) {
                                    icon = (
                                      <div className="flex text-emerald-400 font-black text-[12px] tracking-tighter">
                                        ⇅
                                      </div>
                                    );
                                  } else if (isInjury) {
                                    icon = <span className="text-red-500 font-bold text-[10px]">✚</span>;
                                  } else {
                                    icon = <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />;
                                  }

                                  // Extract players depending on if it's from summary (participants) or details (athletesInvolved)
                                  const players = event.participants?.map((p: any) => p.athlete) || event.athletesInvolved || [];
                                  const primaryPlayer = players[0]?.displayName || players[0]?.shortName || 'Unknown';
                                  const secondaryPlayer = players[1]?.displayName || players[1]?.shortName;
                                  const time = event.clock?.displayValue || Math.floor(event.clock?.value / 60) + "'";

                                  const eventContent = (
                                    <div className={`flex flex-col ${isHome ? 'items-end' : 'items-start'}`}>
                                      <div className="flex items-center gap-2">
                                        {isHome && (
                                          <>
                                            {isSub && secondaryPlayer && <span className="text-[10px] text-red-400 font-medium line-through decoration-red-400/50">{secondaryPlayer}</span>}
                                            <span className="text-xs font-bold text-slate-200">{primaryPlayer}</span>
                                            {event.penaltyKick && <span className="text-[10px] text-slate-500 font-bold">(PEN)</span>}
                                            {event.ownGoal && <span className="text-[10px] text-red-500 font-bold">(OG)</span>}
                                            <div className="flex items-center justify-center w-5 h-5 bg-slate-800 rounded-full border border-slate-700/50 flex-shrink-0">
                                              {icon}
                                            </div>
                                          </>
                                        )}
                                        {!isHome && (
                                          <>
                                            <div className="flex items-center justify-center w-5 h-5 bg-slate-800 rounded-full border border-slate-700/50 flex-shrink-0">
                                              {icon}
                                            </div>
                                            {event.ownGoal && <span className="text-[10px] text-red-500 font-bold">(OG)</span>}
                                            {event.penaltyKick && <span className="text-[10px] text-slate-500 font-bold">(PEN)</span>}
                                            <span className="text-xs font-bold text-slate-200">{primaryPlayer}</span>
                                            {isSub && secondaryPlayer && <span className="text-[10px] text-red-400 font-medium line-through decoration-red-400/50">{secondaryPlayer}</span>}
                                          </>
                                        )}
                                      </div>
                                      {isGoal && secondaryPlayer && (
                                        <span className={`text-[9px] text-slate-500 mt-0.5 ${isHome ? 'mr-7' : 'ml-7'}`}>Ast: {secondaryPlayer}</span>
                                      )}
                                    </div>
                                  );

                                  return (
                                    <div key={ei} className="flex items-center w-full">
                                      <div className="flex-1 pr-2 flex justify-end">
                                        {isHome && eventContent}
                                      </div>
                                      <div className="w-10 text-center flex-shrink-0">
                                        <div className="text-[10px] font-black text-emerald-500">{time}</div>
                                      </div>
                                      <div className="flex-1 pl-2 flex justify-start">
                                        {!isHome && eventContent}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
