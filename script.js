// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', function() {
    loadLinks();
});

// ============ 왼쪽 패널: 상품링크 ============

// 상품링크 추가
function addProductLink() {
    const urlInput = document.getElementById('productUrl');
    const url = urlInput.value.trim();

    if (!url) {
        alert('URL을 입력해주세요.');
        return;
    }

    // 링크 아이템 생성
    const linkList = document.getElementById('linkList');
    const linkItem = document.createElement('div');
    linkItem.className = 'link-item';
    linkItem.innerHTML = `
        <a href="${url}" target="_blank">${url}</a>
        <button class="remove-btn" onclick="removeLink(this)">삭제</button>
    `;
    
    linkList.appendChild(linkItem);
    urlInput.value = '';
    
    // localStorage에 저장
    saveLinks();
}

// 링크 제거
function removeLink(btn) {
    btn.parentElement.remove();
    saveLinks();
}

// 링크 저장 (localStorage)
function saveLinks() {
    const linkList = document.getElementById('linkList');
    const links = Array.from(linkList.querySelectorAll('a')).map(a => a.href);
    localStorage.setItem('productLinks', JSON.stringify(links));
}

// 저장된 링크 로드
function loadLinks() {
    const links = JSON.parse(localStorage.getItem('productLinks') || '[]');
    const linkList = document.getElementById('linkList');

    if (links.length === 0) {
        linkList.innerHTML = '<div class="empty-state">링크를 추가해주세요</div>';
        return;
    }

    linkList.innerHTML = '';
    links.forEach(url => {
        const linkItem = document.createElement('div');
        linkItem.className = 'link-item';
        linkItem.innerHTML = `
            <a href="${url}" target="_blank">${url}</a>
            <button class="remove-btn" onclick="removeLink(this)">삭제</button>
        `;
        linkList.appendChild(linkItem);
    });
}

// ============ 중간 패널: 글자 입력 ============

// 텍스트 반영
function updateMiddleContent() {
    const textContent = document.getElementById('textContent').value;
    const middlePreview = document.getElementById('middlePreview');
    
    if (!textContent) {
        middlePreview.innerHTML = '<div class="empty-state">글을 입력해주세요</div>';
        return;
    }
    
    middlePreview.textContent = textContent;
}

// ============ 오른쪽 패널: HTML 미리보기 ============

// HTML 미리보기
function updatePreview() {
    const htmlContent = document.getElementById('htmlContent').value;
    const preview = document.getElementById('preview');

    if (!htmlContent.trim()) {
        preview.innerHTML = '<div class="empty-state">HTML을 입력해주세요</div>';
        return;
    }

    // iframe 생성 (XSS 방지)
    const iframe = document.createElement('iframe');
    iframe.sandbox.add('allow-scripts', 'allow-same-origin');
    
    preview.innerHTML = '';
    preview.appendChild(iframe);

    // 기본 HTML 구조로 감싸기
    const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { margin: 0; padding: 1rem; font-family: inherit; }
            </style>
        </head>
        <body>
            ${htmlContent}
        </body>
        </html>
    `;

    iframe.contentDocument.open();
    iframe.contentDocument.write(fullHtml);
    iframe.contentDocument.close();
}

// Enter 키로 전송
document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.ctrlKey) {
        if (e.target.id === 'productUrl') {
            addProductLink();
        } else if (e.target.id === 'textContent') {
            updateMiddleContent();
        } else if (e.target.id === 'htmlContent') {
            updatePreview();
        }
    }
});
