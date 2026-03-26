import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { GeminiService, TriageResult } from './gemini';
import { auth, db } from './firebase';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User, signOut } from 'firebase/auth';
import { collection, addDoc, serverTimestamp, doc, setDoc, getDoc } from 'firebase/firestore';
import { animate, stagger } from 'motion';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, ReactiveFormsModule, MatIconModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private gemini = inject(GeminiService);

  triageForm: FormGroup;
  isLoading = signal(false);
  isAuthReady = signal(false);
  currentUser = signal<User | null>(null);
  result = signal<TriageResult | null>(null);
  error = signal<string | null>(null);
  imagePreview = signal<string | null>(null);

  private authUnsubscribe?: () => void;

  constructor() {
    this.triageForm = this.fb.group({
      symptoms: ['', [Validators.required, Validators.minLength(10)]],
      image: [null],
    });
  }

  ngOnInit() {
    this.authUnsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      this.currentUser.set(user);
      if (user) {
        await this.syncUserProfile(user);
      }
      this.isAuthReady.set(true);
    });
  }

  ngOnDestroy() {
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
    }
  }

  private async syncUserProfile(user: User) {
    const userRef = doc(db, 'users', user.uid);
    try {
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          display_name: user.displayName,
          photo_url: user.photoURL,
          role: 'worker',
          created_at: serverTimestamp(),
          last_login: serverTimestamp()
        });
      } else {
        await setDoc(userRef, {
          last_login: serverTimestamp()
        }, { merge: true });
      }
    } catch (err) {
      this.handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
    }
  }

  private handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  }

  async login() {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login failed", err);
      this.error.set("Login failed. Please try again.");
    }
  }

  async logout() {
    try {
      await signOut(auth);
      this.reset();
    } catch (err) {
      console.error("Logout failed", err);
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        this.imagePreview.set(reader.result as string);
        this.triageForm.patchValue({ image: reader.result });
      };
      reader.readAsDataURL(file);
    }
  }

  removeImage() {
    this.imagePreview.set(null);
    this.triageForm.patchValue({ image: null });
  }

  async onSubmit() {
    if (this.triageForm.invalid || !this.currentUser()) return;

    this.isLoading.set(true);
    this.error.set(null);
    this.result.set(null);

    try {
      const { symptoms, image } = this.triageForm.value;
      const triageResult = await this.gemini.analyzeTriage(symptoms, image);
      this.result.set(triageResult);
      
      await this.saveConsultation(symptoms, image, triageResult);

      // Animation for results
      setTimeout(() => {
        const items = document.querySelectorAll('.animate-item');
        if (items.length) {
          animate(items, { opacity: [0, 1], y: [10, 0] }, { delay: stagger(0.05) });
        }
      }, 100);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred during analysis.";
      this.error.set(message);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async saveConsultation(symptoms: string, image: string | null, triageResult: TriageResult) {
    const user = this.currentUser();
    if (!user) return;

    try {
      await addDoc(collection(db, 'consultations'), {
        worker_uid: user.uid,
        patient_symptoms: symptoms,
        image_url: image || null, // In production, upload to Firebase Storage
        triage_result: triageResult,
        timestamp: serverTimestamp()
      });
    } catch (err) {
      this.handleFirestoreError(err, OperationType.CREATE, 'consultations');
    }
  }

  reset() {
    this.triageForm.reset();
    this.result.set(null);
    this.error.set(null);
    this.imagePreview.set(null);
  }

  getPriorityClass(color: string) {
    switch (color) {
      case 'Red': return 'bg-red-50 border-red-200 text-red-900';
      case 'Yellow': return 'bg-amber-50 border-amber-200 text-amber-900';
      case 'Green': return 'bg-emerald-50 border-emerald-200 text-emerald-900';
      default: return 'bg-slate-50 border-slate-200 text-slate-900';
    }
  }

  getPriorityBadgeClass(color: string) {
    switch (color) {
      case 'Red': return 'bg-red-600 text-white';
      case 'Yellow': return 'bg-amber-500 text-white';
      case 'Green': return 'bg-emerald-600 text-white';
      default: return 'bg-slate-500 text-white';
    }
  }
}
