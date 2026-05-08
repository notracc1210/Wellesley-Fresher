// Like reviews on the homepage if you're logged in, AJAX

document.addEventListener('DOMContentLoaded', function() {
    // Get all like buttons
    const likeButtons = document.querySelectorAll('.like-btn');

    likeButtons.forEach(button => {
        button.addEventListener('click', async function(e) {
            e.preventDefault();
            e.stopPropagation();

            const reviewId = this.getAttribute('data-review-id');
            const index = this.getAttribute('data-index');

            try {
                // AJAX request to like/unlike
                const response = await fetch('/like-review', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        reviewId: reviewId
                    })
                });

                // Handle response
                if (!response.ok) {
                    const errorData = await response.json();
                    
                    if (response.status === 401) {
                        alert('You must be logged in to like a review!');
                        window.location.href = '/login';
                        return;
                    } else {
                        console.error('Error:', errorData.error);
                        alert('Error: ' + errorData.error);
                    }
                    return;
                }

                // Get response data
                const data = await response.json();

                if (data.success) {
                    // Update the like count
                    const likeCount = button.querySelector('.like-count');
                    likeCount.textContent = data.likes;

                    // Update the heart icon
                    const heartIcon = button.querySelector('.heart-icon');
                    
                    if (data.isLiked) {
                        // User just liked it
                        heartIcon.textContent = '❤️'; // Filled red heart
                        button.classList.add('liked');
                    } else {
                        // User just unliked it
                        heartIcon.textContent = '🤍'; // Empty white heart
                        button.classList.remove('liked');
                    }

                    console.log('=) ' + data.message);
                } else {
                    console.error('Unexpected response:', data);
                }

            } catch (error) {
                console.error('Error liking review:', error);
                alert('Failed to process like. Please check your connection and try again.');
            }
        });
    });
});