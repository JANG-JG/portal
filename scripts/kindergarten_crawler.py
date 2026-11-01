# -*- coding: utf-8 -*-
"""
유치원 사진 자동 수집 크롤러 모듈
- 본부유치원 홈페이지 로그인 및 게시판별 사진 다운로드
- 중복 게시글 및 중복 사진 선행 스킵
- 환경변수 기반 계정 주입 (보안 강화)
"""

import os
import sys
import json
import time
import random
from datetime import datetime
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, UnexpectedAlertPresentException

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def write_cumulative_log(log_path, final_report, status_str, error_msg=""):
    current_time = datetime.now().strftime("%y년 %m월 %d일 %H:%M:%S")
    log_lines = [
        "=" * 80,
        f"[실행 일시] {current_time}",
        f"[실행 환경] 백그라운드 서버 모드 (Headless)",
        f"[종료 상태] {status_str}" + (f" (오류 원인: {error_msg})" if error_msg else " (정상 완결)"),
        "-" * 80
    ]
    if final_report:
        for b_name, stats in final_report.items():
            log_lines.append(f" * {b_name} -> 신규 다운로드: {stats['downloaded']} 장 / 중복 패스 게시글: {stats['skipped_posts']} 개")
    else:
        log_lines.append(" * 수집된 게시판 데이터가 없거나 로그인 단계에서 중단되었습니다.")
    log_lines.append("=" * 80 + "\n")

    try:
        os.makedirs(os.path.dirname(os.path.abspath(log_path)), exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write("\n".join(log_lines))
        log(f"누적 로그 파일 기록 완료: {log_path}")
    except Exception as e:
        log(f"[경고] 로그 파일 저장 실패: {e}")

def run_crawler():
    user_id = os.environ.get("BONBU_USER_ID", "").strip()
    user_pw = os.environ.get("BONBU_USER_PW", "").strip()
    hdd_base_path = os.environ.get("BONBU_HDD_BASE_PATH", "/mnt/hdd").strip()
    root_url = os.environ.get("BONBU_ROOT_URL", "https://www.bonbu.kr/").strip()
    
    target_boards_raw = os.environ.get("BONBU_TARGET_BOARDS", "{}")
    try:
        target_boards = json.loads(target_boards_raw)
    except Exception:
        target_boards = {
            "소망반_16번게시판": "https://www.bonbu.kr/main/sub.html?boardID=www16",
            "열매반_17번게시판": "https://www.bonbu.kr/main/sub.html?boardID=www17"
        }

    log("=" * 60)
    log("본부유치원 사진 자동 수집 엔진 시작")
    log(f"저장 기본 경로: {hdd_base_path}")
    log(f"수집 대상 게시판: {list(target_boards.keys())}")
    log("=" * 60)

    if not user_id or not user_pw:
        error_msg = "유치원 로그인 아이디 또는 비밀번호가 설정되지 않았습니다."
        log(f"[오류] {error_msg}")
        print(json.dumps({"success": False, "error": error_msg}, ensure_ascii=False))
        return

    # HDD 마운트 확인
    if not os.path.exists(hdd_base_path):
        error_msg = f"지정된 저장 경로({hdd_base_path})가 존재하지 않거나 마운트되지 않았습니다."
        log(f"[오류] {error_msg}")
        print(json.dumps({"success": False, "error": error_msg}, ensure_ascii=False))
        return

    options = webdriver.ChromeOptions()
    options.add_argument('--headless=new')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1500,1000')

    driver = None
    final_report = {}
    status_str = "SUCCESS"
    error_msg = ""
    history_log_path = os.path.join(hdd_base_path, "유치원_사진_다운로드", "collection_history.log")

    try:
        log("1단계: 헤드리스 브라우저 엔진 시작 중...")
        driver = webdriver.Chrome(options=options)
        wait = WebDriverWait(driver, 15)

        log("2단계: 로그인 페이지 직접 진입...")
        login_page_url = f"{root_url.rstrip('/')}/main/sub.html?pageCode=10001"
        driver.get(login_page_url)
        time.sleep(3)

        log("3단계: 로그인 입력창 감지 및 계정 정보 주입...")
        id_field = wait.until(EC.visibility_of_element_located((By.ID, "ANYSECUREINPUT_login_id")))
        pw_field = driver.find_element(By.ID, "ANYSECUREINPUT_login_pw")

        id_field.clear()
        id_field.send_keys(user_id)
        time.sleep(0.3)
        pw_field.clear()
        pw_field.send_keys(user_pw)
        time.sleep(0.3)

        log("4단계: 로그인 요청 제출...")
        driver.execute_script("memberLoginCheck(true);")
        time.sleep(4)

        # Alert 검사 (로그인 실패 시 팝업)
        try:
            alert = driver.switch_to.alert
            alert_text = alert.text
            alert.accept()
            raise Exception(f"유치원 사이트 로그인 실패 안내문: {alert_text}")
        except UnexpectedAlertPresentException as uae:
            raise Exception(f"로그인 경고창: {uae}")
        except Exception as e:
            if "로그인 실패 안내문" in str(e):
                raise e

        # 로그인 성공 여부 검증 (로그아웃 버튼 또는 폼 전환)
        try:
            logout_btn = WebDriverWait(driver, 8).until(
                EC.presence_of_element_located((By.XPATH, "//*[contains(text(), '로그아웃') or contains(@onclick, 'logout')]"))
            )
            log("로그인 성공 확인 (인증 완료)")
        except TimeoutException:
            # 쿠키 확인
            cookies = driver.get_cookies()
            cookie_names = [c.get('name') for c in cookies]
            log(f"로그인 세션 쿠키 목록: {cookie_names}")

        log("5단계: 게시판별 사진 수집 시작...")
        for board_name, board_url in target_boards.items():
            log(f"\n▶ [{board_name}] 수집 작업 시작 (URL: {board_url})")
            final_report[board_name] = {"downloaded": 0, "skipped_posts": 0}

            board_save_dir = os.path.join(hdd_base_path, "유치원_사진_다운로드", board_name)
            os.makedirs(board_save_dir, exist_ok=True)

            # boardID 추출
            board_id_key = "www16"
            if "boardID=" in board_url:
                board_id_key = board_url.split("boardID=")[1].split("&")[0]

            current_page_num = 1
            driver.get(board_url)
            time.sleep(4)

            while True:
                current_list_url = driver.current_url
                log(f" [*] [{board_name}] {current_page_num}페이지 분석 중...")

                all_links = driver.find_elements(By.TAG_NAME, "a")
                post_urls = []
                for link in all_links:
                    try:
                        href = link.get_attribute('href')
                        if href and "Mode=view" in href and f"boardID={board_id_key}" in href:
                            if href not in post_urls:
                                post_urls.append(href)
                    except Exception:
                        continue

                log(f"  -> 감지된 게시글: {len(post_urls)}개")

                for post_url in post_urls:
                    post_num = "000"
                    if "num=" in post_url:
                        try:
                            post_num = post_url.split("num=")[1].split("&")[0]
                        except Exception:
                            pass

                    # [선행 패스] HDD에 해당 글 번호 사진이 이미 있는지 검사
                    try:
                        existing_files = os.listdir(board_save_dir)
                        if any(f.startswith(f"글_{post_num}_") for f in existing_files):
                            final_report[board_name]["skipped_posts"] += 1
                            continue
                    except Exception as err:
                        log(f"  [경고] 폴더 스캔 오류: {err}")

                    # 글 상세 진입
                    try:
                        time.sleep(random.uniform(0.4, 0.8))
                        driver.get(post_url)
                        time.sleep(3.5)

                        img_elements = driver.find_elements(By.XPATH, "//img[contains(@src, '/user/saveDir/board/')]")
                        if not img_elements:
                            img_elements = driver.find_elements(By.CSS_SELECTOR, ".view_content img, #view_content img, td.board_view img, .mdResponsiveBody img")

                        img_count = 1
                        for img in img_elements:
                            try:
                                img_url = img.get_attribute('src')
                                if not img_url or any(x in img_url.lower() for x in ['icon', 'logo', 'button', 'reply', 'blank', 'thum']):
                                    continue

                                pure_name = img_url.split('/')[-1].split('?')[0]
                                if not pure_name or '.' not in pure_name:
                                    pure_name = f"photo_{img_count}.jpg"

                                file_name = f"글_{post_num}_사진_{img_count:02d}_{pure_name}"
                                full_save_path = os.path.join(board_save_dir, file_name)

                                if os.path.exists(full_save_path):
                                    img_count += 1
                                    continue

                                time.sleep(random.uniform(0.1, 0.2))
                                driver.execute_script(f"""
                                var xhr = new XMLHttpRequest();
                                xhr.open('GET', '{img_url}', false);
                                xhr.overrideMimeType('text/plain; charset=x-user-defined');
                                xhr.send(null);
                                var size = xhr.responseText.length;
                                var data = new Uint8Array(size);
                                for (var i = 0; i < size; ++i) {{
                                    data[i] = xhr.responseText.charCodeAt(i) & 0xff;
                                }}
                                window.__img_data = Array.from(data);
                                """)
                                img_bytes = bytes(driver.execute_script("return window.__img_data;"))
                                if img_bytes:
                                    with open(full_save_path, 'wb') as f:
                                        f.write(img_bytes)
                                    final_report[board_name]["downloaded"] += 1
                                    log(f"   └ [다운로드 완료]: {file_name}")
                                    img_count += 1
                            except Exception as img_err:
                                log(f"   └ [이미지 스킵]: {img_err}")
                    except Exception as post_err:
                        log(f"  [글 처리 오류]: {post_err}")
                    finally:
                        try:
                            driver.get(current_list_url)
                            time.sleep(3)
                        except Exception:
                            pass

                # 다음 페이지 탐색
                next_page = current_page_num + 1
                try:
                    next_btn = driver.find_element(By.XPATH, f"//a[text()='{next_page}'] | //a[contains(@href, 'page={next_page}')]")
                    time.sleep(0.5)
                    next_btn.click()
                    current_page_num = next_page
                    time.sleep(4)
                except Exception:
                    log(f"  [{board_name}] 다음 페이지({next_page}) 없음 -> 게시판 완료")
                    break

    except Exception as e:
        status_str = "FAILED"
        error_msg = str(e)
        log(f"[오류 발생] 크롤러 중단: {e}")
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
        log("브라우저 세션 정리 완료")

        write_cumulative_log(history_log_path, final_report, status_str, error_msg)

        total_dl = sum(item["downloaded"] for item in final_report.values())
        total_sk = sum(item["skipped_posts"] for item in final_report.values())

        summary = {
            "success": status_str == "SUCCESS",
            "status": status_str,
            "error": error_msg,
            "executed_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "total_downloaded": total_dl,
            "total_skipped_posts": total_sk,
            "report": final_report
        }
        print("\n--- JSON_RESULT_START ---")
        print(json.dumps(summary, ensure_ascii=False))
        print("--- JSON_RESULT_END ---")

if __name__ == "__main__":
    run_crawler()
