// Frontend functionality for registration form
document.addEventListener('DOMContentLoaded', function () {
	const forms = document.querySelectorAll('.fair-registration-form-element');

	forms.forEach(function (form) {
		form.addEventListener('submit', function (e) {
			e.preventDefault();

			// Basic form validation
			const requiredFields = form.querySelectorAll('[required]');
			let isValid = true;

			requiredFields.forEach(function (field) {
				if (!field.value.trim()) {
					isValid = false;
					field.classList.add('error');
				} else {
					field.classList.remove('error');
				}
			});

			if (isValid) {
				// Form is valid, you can submit it here
				console.log('Form is valid and ready to submit');
				// form.submit(); // Uncomment when backend is ready
			} else {
				console.log('Please fill in all required fields');
			}
		});
	});
});
