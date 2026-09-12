// Триггер Бар — общая логика: бургер-меню, появление блоков при скролле, форма брони

(function(){
  var nav = document.querySelector('.nav');
  var burger = document.querySelector('.nav__burger');
  if (burger && nav){
    burger.addEventListener('click', function(){
      nav.classList.toggle('is-open');
    });
    nav.querySelectorAll('.nav__links a').forEach(function(a){
      a.addEventListener('click', function(){ nav.classList.remove('is-open'); });
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

  // Формы (бронь, обратная связь): пока без бэкенда — визуальное подтверждение отправки.
  function wireForm(formSelector, statusSelector, successText){
    var form = document.querySelector(formSelector);
    if (!form) return;
    var status = form.querySelector(statusSelector);
    var button = form.querySelector('button[type="submit"]');
    var originalLabel = button ? button.textContent : '';
    form.addEventListener('submit', function(e){
      e.preventDefault();
      if (!form.checkValidity()){
        form.reportValidity();
        return;
      }
      button.disabled = true;
      button.textContent = 'Отправляем…';
      setTimeout(function(){
        form.reset();
        button.disabled = false;
        button.textContent = originalLabel;
        if (status){
          status.hidden = false;
          status.textContent = successText;
        }
      }, 700);
    });
  }

  wireForm('.booking-form', '.booking-form__status', 'Заявка оформлена! Мы свяжемся с вами, чтобы подтвердить бронь.');
  wireForm('.contacts-form', '.contacts-form__status', 'Сообщение отправлено! Мы ответим в ближайшее время.');

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
