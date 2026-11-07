/**
 * 🤖 관리자 AI 비서 운영 관리 엔진 (admin-ai.js)
 * - 첫 환영 인사말 및 1회 질문 글자 수 제한 설정 제어
 * - [규칙 2] 100% 한국어 인터페이스 | [규칙 3] 500줄 이하 모듈화
 */

(function() {
    'use strict';

    /**
     * AI 비서 설정 불러오기
     */
    async function loadAdminAiConfig() {
        try {
            const res = await fetch('/api/admin/ai', {
                headers: { 'Accept': 'application/json' }
            });
            if (!res.ok) throw new Error('설정을 불러오지 못했습니다.');
            const data = await res.json();
            if (data.success && data.config) {
                const welcomeInput = document.getElementById('inputAiWelcomeMessage');
                const maxLenInput = document.getElementById('inputAiMaxPromptLength');
                const heroIconInput = document.getElementById('inputAiHeroIcon');
                const heroTitleInput = document.getElementById('inputAiHeroTitle');
                const heroDescInput = document.getElementById('inputAiHeroDesc');

                if (welcomeInput) welcomeInput.value = data.config.welcomeMessage || '';
                if (maxLenInput) maxLenInput.value = data.config.maxPromptLength || 1000;
                if (heroIconInput) heroIconInput.value = data.config.heroIcon || '🤖';
                if (heroTitleInput) heroTitleInput.value = data.config.heroTitle || 'AI 비서에게 무엇이든 물어보세요';
                if (heroDescInput) heroDescInput.value = data.config.heroDescription || 'JG 포털 로컬 AI가 질문에 친절하고 안전하게 답변해 드립니다.';

                // 모델 및 컨텍스트 창 설정
                const env = data.envDefaults || {};
                const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
                setVal('inputAiChatModel', data.config.chatModel || '');
                setVal('inputAiReasoningModel', data.config.reasoningModel || '');
                setVal('inputAiChatNumCtx', data.config.chatNumCtx || 0);
                setVal('inputAiReasoningNumCtx', data.config.reasoningNumCtx || 0);
                const chatModelEl = document.getElementById('inputAiChatModel');
                const reasonModelEl = document.getElementById('inputAiReasoningModel');
                if (chatModelEl && env.chatModel) chatModelEl.placeholder = `기본값: ${env.chatModel}`;
                if (reasonModelEl && env.reasoningModel) reasonModelEl.placeholder = `기본값: ${env.reasoningModel}`;
                const hintEl = document.getElementById('aiEnvModelHint');
                if (hintEl && env.chatModel) hintEl.textContent = `${env.chatModel} / ${env.reasoningModel || env.chatModel}`;

                updateAiWelcomePreview();
                updateAiHeroPreview();

                // 뉴스 AI 요약 모델 동기화
                try {
                    const newsModelRes = await fetch('/api/admin/news/summary-model');
                    const newsModelData = await newsModelRes.json();
                    if (newsModelData.success && newsModelData.currentModel) {
                        const newsSel = document.getElementById('inputAiNewsSummaryModel');
                        if (newsSel) newsSel.value = newsModelData.currentModel;
                    }
                } catch (e) {}
            }
        } catch (err) {
            console.error('[admin-ai] 설정 로드 오류:', err);
            if (typeof showToast === 'function') {
                showToast('AI 비서 설정을 불러오는 중 오류가 발생했습니다.', 'error');
            }
        }
    }

    /**
     * AI 비서 설정 저장
     */
    async function saveAdminAiConfig(e) {
        if (e && e.preventDefault) e.preventDefault();

        const welcomeInput = document.getElementById('inputAiWelcomeMessage');
        const maxLenInput = document.getElementById('inputAiMaxPromptLength');
        const heroIconInput = document.getElementById('inputAiHeroIcon');
        const heroTitleInput = document.getElementById('inputAiHeroTitle');
        const heroDescInput = document.getElementById('inputAiHeroDesc');
        if (!welcomeInput || !maxLenInput) return;

        const welcomeMessage = welcomeInput.value.trim();
        const maxPromptLength = parseInt(maxLenInput.value, 10);
        const heroIcon = heroIconInput ? heroIconInput.value.trim() : '🤖';
        const heroTitle = heroTitleInput ? heroTitleInput.value.trim() : 'AI 비서에게 무엇이든 물어보세요';
        const heroDescription = heroDescInput ? heroDescInput.value.trim() : '';

        if (!welcomeMessage) {
            alert('새 대화 첫 환영 인사말을 입력해 주세요.');
            welcomeInput.focus();
            return;
        }

        if (isNaN(maxPromptLength) || maxPromptLength < 100 || maxPromptLength > 4000) {
            alert('최대 글자 수는 100자에서 4,000자 사이로 설정해 주세요.');
            maxLenInput.focus();
            return;
        }

        if (!heroIcon) {
            alert('대표 아이콘(이모지)을 입력해 주세요.');
            if (heroIconInput) heroIconInput.focus();
            return;
        }

        if (!heroTitle) {
            alert('히어로 카드 메인 타이틀을 입력해 주세요.');
            if (heroTitleInput) heroTitleInput.focus();
            return;
        }

        try {
            const res = await fetch('/api/admin/ai', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    welcomeMessage,
                    maxPromptLength,
                    heroIcon,
                    heroTitle,
                    heroDescription,
                    chatModel: (document.getElementById('inputAiChatModel') || {}).value?.trim() ?? undefined,
                    reasoningModel: (document.getElementById('inputAiReasoningModel') || {}).value?.trim() ?? undefined,
                    chatNumCtx: parseInt((document.getElementById('inputAiChatNumCtx') || {}).value, 10) || 0,
                    reasoningNumCtx: parseInt((document.getElementById('inputAiReasoningNumCtx') || {}).value, 10) || 0
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || '저장 실패');
            }

            if (typeof showToast === 'function') {
                showToast('AI 비서 설정이 DB에 성공적으로 저장되었습니다. ✅', 'success');
            } else {
                alert('AI 비서 설정이 DB에 성공적으로 저장되었습니다.');
            }
        } catch (err) {
            console.error('[admin-ai] 설정 저장 오류:', err);
            if (typeof showToast === 'function') {
                showToast(`설정 저장 실패: ${err.message}`, 'error');
            } else {
                alert(`설정 저장 실패: ${err.message}`);
            }
        }
    }

    /**
     * 환영 인사말 실시간 미리보기 및 글자 수 카운터
     */
    function updateAiWelcomePreview() {
        const welcomeInput = document.getElementById('inputAiWelcomeMessage');
        const previewEl = document.getElementById('aiWelcomeBubblePreview');
        const counterEl = document.getElementById('aiWelcomeLengthCounter');
        if (!welcomeInput) return;

        const text = welcomeInput.value || '';
        if (counterEl) {
            counterEl.textContent = `${text.length}/500자`;
        }

        if (previewEl) {
            if (!text.trim()) {
                previewEl.textContent = '인사말을 입력하면 이곳에 실시간 표시됩니다.';
                previewEl.style.color = '#94a3b8';
            } else {
                // XSS 방어 후 안전한 줄바꿈 <br> 변환
                const safeText = text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;')
                    .replace(/\n/g, '<br>');
                previewEl.innerHTML = safeText;
                previewEl.style.color = '#1e293b';
            }
        }
    }

    /**
     * 글자 수 프리셋 버튼 클릭
     */
    function setAiLengthPreset(len) {
        const maxLenInput = document.getElementById('inputAiMaxPromptLength');
        if (maxLenInput) {
            maxLenInput.value = len;
        }
    }

    function setAiReasoningCtxPreset(ctx) {
        const ctxInput = document.getElementById('inputAiReasoningNumCtx');
        if (ctxInput) ctxInput.value = ctx;
    }

    /**
     * 로컬 AI 노드 헬스체크
     */
    async function checkAdminAiHealth() {
        const statusBadge = document.getElementById('adminAiStatusBadge');
        const latencyEl = document.getElementById('adminAiStatusLatency');
        if (statusBadge) statusBadge.textContent = '🟡 진단 중...';

        const startTime = Date.now();
        try {
            const res = await fetch('/api/admin/ai/health', {
                headers: { 'Accept': 'application/json' }
            });
            const latency = Date.now() - startTime;
            const data = await res.json();

            if (res.ok && data.success && data.health && data.health.healthy) {
                if (statusBadge) {
                    statusBadge.textContent = '🟢 정상 가동 중 (온라인)';
                    statusBadge.style.color = '#10b981';
                }
                if (latencyEl) {
                    latencyEl.textContent = `지연 시간: ${latency}ms (응답 양호)`;
                }
            } else {
                if (statusBadge) {
                    statusBadge.textContent = '🔴 연결 지연 또는 오프라인';
                    statusBadge.style.color = '#ef4444';
                }
                if (latencyEl) {
                    latencyEl.textContent = `확인 필요: 로컬 PC Ollama 데몬 상태를 점검하세요.`;
                }
            }
        } catch (err) {
            if (statusBadge) {
                statusBadge.textContent = '🔴 점검 오류';
                statusBadge.style.color = '#ef4444';
            }
            if (latencyEl) {
                latencyEl.textContent = `네트워크 오류: ${err.message}`;
            }
        }
    }

    /**
     * 히어로 카드 실시간 미리보기 및 글자 수 카운터
     */
    function updateAiHeroPreview() {
        const iconInput = document.getElementById('inputAiHeroIcon');
        const titleInput = document.getElementById('inputAiHeroTitle');
        const descInput = document.getElementById('inputAiHeroDesc');

        const previewIcon = document.getElementById('aiHeroPreviewIcon');
        const previewTitle = document.getElementById('aiHeroPreviewTitle');
        const previewDesc = document.getElementById('aiHeroPreviewDesc');

        const titleCounter = document.getElementById('aiHeroTitleCounter');
        const descCounter = document.getElementById('aiHeroDescCounter');

        const iconVal = (iconInput && iconInput.value.trim()) ? iconInput.value.trim() : '🤖';
        const titleVal = (titleInput && titleInput.value.trim()) ? titleInput.value.trim() : 'AI 비서에게 무엇이든 물어보세요';
        const descVal = (descInput && descInput.value.trim()) ? descInput.value.trim() : 'JG 포털 로컬 AI가 질문에 친절하고 안전하게 답변해 드립니다.';

        if (titleCounter && titleInput) {
            titleCounter.textContent = `${titleInput.value.length}/100자`;
        }
        if (descCounter && descInput) {
            descCounter.textContent = `${descInput.value.length}/300자`;
        }

        if (previewIcon) previewIcon.textContent = iconVal;
        if (previewTitle) previewTitle.textContent = titleVal;
        if (previewDesc) {
            previewDesc.innerHTML = descVal
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;')
                .replace(/\n/g, '<br>');
        }
    }

    /**
     * 대표 아이콘 프리셋 클릭 핸들러
     */
    function setAiHeroIconPreset(icon) {
        const iconInput = document.getElementById('inputAiHeroIcon');
        if (iconInput) {
            iconInput.value = icon;
            updateAiHeroPreview();
        }
    }

    /**
     * AI 비서 탭에서 뉴스 AI 요약 모델 변경 시 동기화 저장
     */
    async function syncNewsSummaryModelFromAiTab(model) {
        if (typeof window.saveAdminNewsModel === 'function') {
            await window.saveAdminNewsModel(model);
        } else {
            try {
                const res = await fetch('/api/admin/news/summary-model', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model })
                });
                const data = await res.json();
                if (data.success) {
                    alert(data.message || `뉴스 AI 요약 모델이 '${model}'(으)로 저장되었습니다.`);
                } else {
                    alert('저장 실패: ' + (data.message || '오류 발생'));
                }
            } catch (e) {
                alert('통신 오류: ' + e.message);
            }
        }
    }

    // 전역 노출
    window.loadAdminAiConfig = loadAdminAiConfig;
    window.saveAdminAiConfig = saveAdminAiConfig;
    window.updateAiWelcomePreview = updateAiWelcomePreview;
    window.updateAiHeroPreview = updateAiHeroPreview;
    window.setAiHeroIconPreset = setAiHeroIconPreset;
    window.setAiLengthPreset = setAiLengthPreset;
    window.setAiReasoningCtxPreset = setAiReasoningCtxPreset;
    window.checkAdminAiHealth = checkAdminAiHealth;
    window.syncNewsSummaryModelFromAiTab = syncNewsSummaryModelFromAiTab;

    // DOM 로드 시 초기화
    document.addEventListener('DOMContentLoaded', () => {
        loadAdminAiConfig();
    });
})();
