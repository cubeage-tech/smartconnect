import { MotionConfig } from 'motion/react';
import { RouterProvider } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { lazy, Suspense } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { useResolvedTheme } from './lib/theme';
import { router } from './routes/router';

// T.37: development-only per-tab sign-in control (lib/devTabSession.ts).
// `import.meta.env.DEV` is `false` in production builds, so this import and
// its chunk are dropped there entirely.
const DevTabSessionPanel = import.meta.env.DEV ? lazy(() => import('./components/dev/DevTabSessionPanel')) : null;

export default function App() {
  // QA L2: toasts follow the app theme (light/dark), not the library default.
  const theme = useResolvedTheme();
  return (
    // T.32: motion-library animations follow the OS "reduce motion" setting
    // (CSS animations already do — index.css).
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <RouterProvider router={router} />
        {DevTabSessionPanel && (
          <Suspense fallback={null}>
            <DevTabSessionPanel />
          </Suspense>
        )}
        <ToastContainer position="top-right" theme={theme} autoClose={4000} newestOnTop closeOnClick hideProgressBar />
      </AuthProvider>
    </MotionConfig>
  );
}
