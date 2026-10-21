// ==============================================================================
// 🖥️ JG 포털 서버 인프라 관리 엔진 (portal-infra.js)
// - 주서버: 삼성 갤럭시 노트 9 (Exynos 9810, ARM64 PRoot)
// - 보조서버: HP 15-g008au (구형 노트북, 500GB HDD 새벽 04:00 백업)
// - 뷰 모드 토글: [통합] / [주서버] / [보조서버]
// ==============================================================================

// 🔄 1. 서버 인프라 메트릭 실시간 바인딩
function bindServerInfraData(sysData) {
    if (!sysData) return;

    // 주서버 (갤럭시 노트 9) 바인딩
    if (sysData.primary) {
        const pri = sysData.primary;
        const priCpu = document.getElementById('serverPriCpu');
        const priRam = document.getElementById('serverPriRam');
        const priDisk = document.getElementById('serverPriDisk');
        const priNet = document.getElementById('serverPriNet');
        const priBadge = document.getElementById('serverPriBadge');
        if (priCpu && pri.cpu) priCpu.textContent = pri.cpu;
        if (priRam && pri.ram) priRam.textContent = pri.ram;
        if (priDisk && pri.disk) priDisk.textContent = pri.disk;
        if (priNet && pri.network) priNet.textContent = pri.network;
        if (priBadge && pri.statusText) {
            priBadge.textContent = pri.statusText;
            priBadge.className = 'bento-badge badge-emerald';
        }
    }

    // 보조서버 (구형 노트북) 바인딩
    if (sysData.secondary) {
        const sec = sysData.secondary;
        const secCpu = document.getElementById('serverSecCpu');
        const secRam = document.getElementById('serverSecRam');
        const secDisk = document.getElementById('serverSecDisk');
        const secNet = document.getElementById('serverSecNet');
        const secTemp = document.getElementById('serverSecTemp');
        const secBadge = document.getElementById('serverSecBadge');
        if (secCpu && sec.cpu) secCpu.textContent = sec.cpu;
        if (secRam && sec.ram) secRam.textContent = sec.ram;
        if (secDisk && sec.disk) secDisk.textContent = sec.disk;
        if (secNet && sec.network) secNet.textContent = sec.network;
        if (secTemp && sec.temp) secTemp.textContent = sec.temp;
        if (secBadge) {
            if (sec.status === 'online') {
                secBadge.textContent = '가동 중';
                secBadge.className = 'bento-badge badge-emerald';
            } else {
                secBadge.textContent = sec.statusText || '백업 대기';
                secBadge.className = 'bento-badge badge-gray';
            }
        }
    }
}

// 🔀 2. 서버 뷰 모드 전환 핸들러 (dual: 2단 통합, pri: 주서버 단독, sec: 보조서버 단독)
function setServerViewMode(mode) {
    const btnDual = document.getElementById('btnServerDual');
    const btnPri = document.getElementById('btnServerPri');
    const btnSec = document.getElementById('btnServerSec');
    const unitPri = document.getElementById('serverUnitPri');
    const unitSec = document.getElementById('serverUnitSec');
    const dualGrid = document.getElementById('serverDualGrid');

    [btnDual, btnPri, btnSec].forEach(b => { if (b) b.classList.remove('active'); });

    if (mode === 'pri') {
        if (btnPri) btnPri.classList.add('active');
        if (unitPri) unitPri.style.display = 'flex';
        if (unitSec) unitSec.style.display = 'none';
        if (dualGrid) dualGrid.style.gridTemplateColumns = '1fr';
    } else if (mode === 'sec') {
        if (btnSec) btnSec.classList.add('active');
        if (unitPri) unitPri.style.display = 'none';
        if (unitSec) unitSec.style.display = 'flex';
        if (dualGrid) dualGrid.style.gridTemplateColumns = '1fr';
    } else {
        if (btnDual) btnDual.classList.add('active');
        if (unitPri) unitPri.style.display = 'flex';
        if (unitSec) unitSec.style.display = 'flex';
        if (dualGrid) {
            dualGrid.style.gridTemplateColumns = '';
        }
    }
}
