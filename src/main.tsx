import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import App from './App.tsx';
import {ScopeProvider} from './context/ScopeContext.tsx';
import {ToastProvider} from './context/ToastContext.tsx';
import {ConfirmProvider} from './context/ConfirmContext.tsx';
import {WelcomeTourProvider} from './context/WelcomeTourContext.tsx';
import './index.css';

// CONSTITUTION §1.1: 1 QueryClient duy nhất ở root. Chưa cấu hình staleTime/
// retry đặc thù ở T-S06a (setup) -- để mặc định TanStack Query, tinh chỉnh
// (nếu cần) thuộc phạm vi các task migrate hook sau (T-S06b trở đi) khi có
// dữ liệu thật để đánh giá.
const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ScopeProvider>
        {/* T-S07 — toast toàn cục (Undo xoá giao dịch), đặt trong cùng
            ScopeProvider vì không phụ thuộc scope nhưng cần nằm trên App để
            mọi component con đều gọi được useToast(). */}
        <ToastProvider>
          {/* [T-S124, 22/08/2026] Modal xác nhận toàn cục — thay window.confirm()
              native. Đặt trong ToastProvider (thứ tự không quan trọng, 2 context
              độc lập nhau) để mọi component con đều gọi được useConfirm(). */}
          <ConfirmProvider>
            {/* [T-S135, 23/08/2026] Tour chào mừng toàn cục — đặt cạnh
                ConfirmProvider (2 context độc lập, thứ tự không quan trọng)
                để cả App.tsx lẫn trung tâm trợ giúp sau này (T-S136) đều
                gọi được useWelcomeTour(). */}
            <WelcomeTourProvider>
              <App />
            </WelcomeTourProvider>
          </ConfirmProvider>
        </ToastProvider>
      </ScopeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
