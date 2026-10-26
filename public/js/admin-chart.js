/**
 * JG Portal 통합 관리자 센터 - 실시간 리소스 시계열 차트 모듈 (uPlot)
 * admin-chart.js
 */

// 📈 초경량 uPlot (10KB) 실시간 시계열 리소스 차트 상태 (듀얼 서버 CPU/RAM 4종 관제)
let uplotChart = null;
const uplotData = [
    [], // 0: UNIX 타임스탬프 (초)
    [], // 1: 📱 주 서버 CPU (%)
    [], // 2: 📱 주 서버 RAM (%)
    [], // 3: 💻 보조 서버 CPU (%)
    []  // 4: 💻 보조 서버 RAM (%)
];
const MAX_CHART_POINTS = 30; // 5초 간격 * 30회 = 최근 150초 (2.5분)

function initUPlotChart() {
    const container = document.getElementById('uplotResourceContainer');
    if (!container || typeof uPlot === 'undefined') return;
    if (uplotChart) return;

    // 초기 데이터 (현재 시각 기준 과거 8포인트 0% 초기화)
    const now = Math.floor(Date.now() / 1000);
    if (uplotData[0].length === 0) {
        for (let i = 8; i >= 0; i--) {
            uplotData[0].push(now - i * 5);
            uplotData[1].push(0);
            uplotData[2].push(0);
            uplotData[3].push(0);
            uplotData[4].push(0);
        }
    }

    const opts = {
        width: Math.max(240, container.clientWidth || 320),
        height: 140,
        scales: {
            x: { time: true },
            y: { range: [0, 100] }
        },
        series: [
            {},
            {
                label: "📱 주 CPU",
                stroke: "#2563eb",
                width: 2,
                fill: "rgba(37, 99, 235, 0.10)",
                points: { show: false }
            },
            {
                label: "📱 주 RAM",
                stroke: "#7c3aed",
                width: 2,
                fill: "rgba(124, 58, 237, 0.08)",
                points: { show: false }
            },
            {
                label: "💻 보조 CPU",
                stroke: "#d97706",
                width: 1.8,
                dash: [4, 4],
                points: { show: false }
            },
            {
                label: "💻 보조 RAM",
                stroke: "#059669",
                width: 1.8,
                dash: [4, 4],
                points: { show: false }
            }
        ],
        axes: [
            {
                stroke: "#64748b",
                grid: { stroke: "rgba(148, 163, 184, 0.18)", width: 1 },
                ticks: { stroke: "rgba(148, 163, 184, 0.25)" },
                font: '10px Pretendard, system-ui'
            },
            {
                stroke: "#64748b",
                grid: { stroke: "rgba(148, 163, 184, 0.18)", width: 1 },
                ticks: { stroke: "rgba(148, 163, 184, 0.25)" },
                values: (u, vals) => vals.map(v => Math.round(v) + "%"),
                font: '10px Pretendard, system-ui'
            }
        ],
        cursor: {
            drag: { setScale: false }
        }
    };

    try {
        uplotChart = new uPlot(opts, uplotData, container);
    } catch (e) {
        console.warn('uPlot 초기화 보류:', e);
    }

    const resizeChart = () => {
        if (uplotChart && container && container.clientWidth > 0) {
            uplotChart.setSize({
                width: container.clientWidth,
                height: 140
            });
        }
    };

    window.addEventListener('resize', resizeChart);
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(resizeChart);
        ro.observe(container);
    }
}

function updateUPlotData(pCpu, pRam, sCpu, sRam, sOnline) {
    const container = document.getElementById('uplotResourceContainer');
    if (!container || typeof uPlot === 'undefined') return;

    if (!uplotChart) {
        initUPlotChart();
    }

    const now = Math.floor(Date.now() / 1000);
    const pCpuNum = Math.min(100, Math.max(0, Math.round(pCpu || 0)));
    const pRamNum = Math.min(100, Math.max(0, Math.round(pRam || 0)));
    const sCpuNum = sOnline ? Math.min(100, Math.max(0, Math.round(sCpu || 0))) : 0;
    const sRamNum = sOnline ? Math.min(100, Math.max(0, Math.round(sRam || 0))) : 0;

    // 상단 뱃지 텍스트 4종 갱신
    const pCpuEl = document.getElementById('uplotPrimaryCpuText');
    const pRamEl = document.getElementById('uplotPrimaryRamText');
    const sCpuEl = document.getElementById('uplotSecCpuText');
    const sRamEl = document.getElementById('uplotSecRamText');
    if (pCpuEl) pCpuEl.textContent = `${pCpuNum}%`;
    if (pRamEl) pRamEl.textContent = `${pRamNum}%`;
    if (sCpuEl) sCpuEl.textContent = sOnline ? `${sCpuNum}%` : '대기';
    if (sRamEl) sRamEl.textContent = sOnline ? `${sRamNum}%` : '대기';

    uplotData[0].push(now);
    uplotData[1].push(pCpuNum);
    uplotData[2].push(pRamNum);
    uplotData[3].push(sCpuNum);
    uplotData[4].push(sRamNum);

    if (uplotData[0].length > MAX_CHART_POINTS) {
        uplotData[0].shift();
        uplotData[1].shift();
        uplotData[2].shift();
        uplotData[3].shift();
        uplotData[4].shift();
    }

    if (uplotChart) {
        uplotChart.setData(uplotData);
    }
}

// 전역 window 바인딩
window.initUPlotChart = initUPlotChart;
window.updateUPlotData = updateUPlotData;
