document.addEventListener('DOMContentLoaded', () => {
    const particlesContainer = document.querySelector('.particles');

    // Функция для создания случайной искры
    function createParticle() {
        const particle = document.createElement('div');
        particle.classList.add('particle');

        // Случайный размер и позиция
        const size = Math.random() * 5 + 5;  // размер от 5 до 10px
        const left = Math.random() * window.innerWidth;
        const top = Math.random() * window.innerHeight;

        // Случайная траектория для искры
        const moveX = (Math.random() - 0.5) * 500;
        const moveY = (Math.random() - 0.5) * 500;

        // Устанавливаем размеры и позицию
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.left = `${left}px`;
        particle.style.top = `${top}px`;

        // Добавляем кастомные значения для анимации
        particle.style.setProperty('--move-x', `${moveX}px`);
        particle.style.setProperty('--move-y', `${moveY}px`);

        // Добавляем частицу в контейнер
        particlesContainer.appendChild(particle);

        // Удаляем частицу после анимации
        setTimeout(() => {
            particle.remove();
        }, 2000);  // Удаляем через 2 секунды (время анимации)
    }

    // Запускаем создание частиц каждую секунду
    setInterval(createParticle, 100);
});