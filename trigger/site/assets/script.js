// Триггер Бар — общая логика: бургер-меню, появление блоков при скролле, форма брони

(function(){
  try {
    if (localStorage.getItem('triggerbar_age_ok') !== '1'){
      var overlay = document.createElement('div');
      overlay.className = 'age-gate';
      overlay.innerHTML =
        '<div class="age-gate__card">' +
          '<span class="age-gate__badge">18+</span>' +
          '<h3>Только для взрослых</h3>' +
          '<p>Триггер Бар — заведение для гостей старше 18 лет. Продолжая, вы подтверждаете свой возраст.</p>' +
          '<div class="age-gate__actions">' +
            '<button type="button" class="btn age-gate__yes">Мне есть 18</button>' +
            '<a href="https://www.google.com" class="age-gate__no">Мне нет 18</a>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      overlay.querySelector('.age-gate__yes').addEventListener('click', function(){
        try { localStorage.setItem('triggerbar_age_ok', '1'); } catch(e){}
        overlay.remove();
        document.body.style.overflow = '';
      });
    }
  } catch(e){}
})();

(function(){
  var nav = document.querySelector('.nav');
  var burger = document.querySelector('.nav__burger');
  var menuBtn = document.querySelector('.nav__menu-btn');
  if (nav && (burger || menuBtn)){
    var toggleNav = function(){
      var isOpen = nav.classList.toggle('is-open');
      if (menuBtn) menuBtn.textContent = isOpen ? 'Закрыть' : 'Меню';
    };
    if (burger) burger.addEventListener('click', toggleNav);
    if (menuBtn) menuBtn.addEventListener('click', toggleNav);
    nav.querySelectorAll('.nav__links a').forEach(function(a){
      a.addEventListener('click', function(){
        nav.classList.remove('is-open');
        if (menuBtn) menuBtn.textContent = 'Меню';
      });
    });
  }

  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (entry.isIntersecting){
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function(el){ io.observe(el); });
  } else {
    revealEls.forEach(function(el){ el.classList.add('is-visible'); });
  }

  // Лёгкий параллакс картинки в hero — двигается медленнее скролла, добавляет глубину.
  var heroBg = document.querySelector('.hero__bg-wrap');
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (heroBg && !prefersReducedMotion){
    var ticking = false;
    var updateParallax = function(){
      var y = window.scrollY || window.pageYOffset;
      heroBg.style.transform = 'translateY(' + Math.min(y * 0.15, 70) + 'px)';
      ticking = false;
    };
    window.addEventListener('scroll', function(){
      if (!ticking){
        window.requestAnimationFrame(updateParallax);
        ticking = true;
      }
    }, { passive: true });
  }

  // Куда формы отправляют заявку — воркер на Cloudflare. Он передаёт бронь в
  // Telegram, а вопрос с формы обратной связи — письмом на почту бара. Токен
  // бота и пароль от почты хранятся там, в коде сайта их быть не должно.
  // Исходник воркера и порядок подключения — sites/trigger/worker/.
  // Если сюда вписать пустую строку, вернётся демо-режим: сообщение об
  // отправке показывается, но заявка никуда не уходит.
  var FORMS_ENDPOINT = 'https://trigger-bar-forms.rossovaulia8.workers.dev';

  var PHONE_HINT = 'Не получилось отправить заявку. Позвоните нам: +7 926 828-42-32';

  // Формы (бронь, обратная связь)
  function wireForm(formSelector, statusSelector, formName, successText, endpoint){
    var form = document.querySelector(formSelector);
    if (!form) return;
    var status = form.querySelector(statusSelector);
    var button = form.querySelector('button[type="submit"]');
    var originalLabel = button ? button.textContent : '';

    function showStatus(text, isError){
      if (!status) return;
      status.hidden = false;
      status.textContent = text;
      status.classList.toggle('is-error', !!isError);
    }
    function releaseButton(){
      button.disabled = false;
      button.textContent = originalLabel;
    }

    form.addEventListener('submit', function(e){
      e.preventDefault();
      if (!form.checkValidity()){
        form.reportValidity();
        return;
      }
      button.disabled = true;
      button.textContent = 'Отправляем…';

      // Демо-режим: адрес не задан — заявка никуда не уходит
      if (!endpoint){
        setTimeout(function(){
          form.reset();
          releaseButton();
          showStatus(successText, false);
        }, 700);
        return;
      }

      var payload = { form: formName };
      new FormData(form).forEach(function(value, key){ payload[key] = value; });
      // У галочки в FormData значение 'on', а воркер ждёт да/нет
      payload.consent = form.querySelector('[name="consent"]').checked;

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function(res){ return res.json().catch(function(){ return { ok: false }; }); })
        .then(function(res){
          if (!res.ok) throw new Error('send failed');
          form.reset();
          releaseButton();
          showStatus(successText, false);
        })
        .catch(function(){
          // Заявка не дошла — честно говорим об этом и даём телефон,
          // иначе гость уйдёт уверенным, что стол забронирован.
          releaseButton();
          showStatus(PHONE_HINT, true);
        });
    });
  }

  // Время визита: бар работает Вс–Чт 16:00–23:00, Пт–Сб 16:00–01:00.
  // Показываем только рабочие часы, последний слот — за полчаса до закрытия.
  // Иначе гость бронирует на 9 утра, и сотруднику приходится перезванивать
  // и объяснять, что бар закрыт.
  var timeSelect = document.getElementById('bf-time');
  var bookingDate = document.getElementById('bf-date');
  if (timeSelect && bookingDate){
    var pad = function(n){ return (n < 10 ? '0' : '') + n; };
    var fillTimeSlots = function(){
      var lateNight = false;
      if (bookingDate.value){
        // 'T00:00' — иначе Safari считает дату по Гринвичу и день съезжает
        var day = new Date(bookingDate.value + 'T00:00').getDay();
        lateNight = (day === 5 || day === 6); // пятница и суббота
      }
      var lastSlot = lateNight ? 24 * 60 + 30 : 22 * 60 + 30;
      var chosen = timeSelect.value;
      var html = '<option value="" disabled' + (chosen ? '' : ' selected') + '>Выберите время</option>';
      for (var m = 16 * 60; m <= lastSlot; m += 30){
        var label = pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
        html += '<option value="' + label + '"' + (label === chosen ? ' selected' : '') + '>' + label + '</option>';
      }
      timeSelect.innerHTML = html;
    };
    bookingDate.addEventListener('change', fillTimeSlots);
    fillTimeSlots();
  }

  wireForm('.booking-form', '.booking-form__status', 'booking',
    'Заявка оформлена! Мы свяжемся с вами, чтобы подтвердить бронь.', FORMS_ENDPOINT);

  // Форма вопросов уходит письмом на рабочую почту бара (info@triggerpub.ru),
  // а не в Telegram: на вопрос можно ответить не спеша, в отличие от брони.
  wireForm('.contacts-form', '.contacts-form__status', 'contact',
    'Сообщение отправлено! Мы ответим в ближайшее время.', FORMS_ENDPOINT);

  // Подсказка «→» у списка разделов меню: скрываем её, когда докрутили до конца.
  var menuNav = document.querySelector('.menu-nav');
  if (menuNav){
    var updateMenuNavHint = function(){
      var atEnd = menuNav.scrollLeft + menuNav.clientWidth >= menuNav.scrollWidth - 4;
      menuNav.classList.toggle('is-end', atEnd);
    };
    updateMenuNavHint();
    menuNav.addEventListener('scroll', updateMenuNavHint, { passive: true });
    window.addEventListener('resize', updateMenuNavHint);
  }
})();
