import './frontend.css';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';

/**
 * Frontend JavaScript for Fair RSVP button
 *
 * @package FairRsvp
 */

(function () {
	'use strict';

	// Defensive: handle both scenarios (DOM loading or already loaded)
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initializeRsvpForms);
	} else {
		initializeRsvpForms();
	}

	/**
	 * Initialize all RSVP forms on the page
	 */
	function initializeRsvpForms() {
		const forms = document.querySelectorAll('.fair-rsvp-form');

		forms.forEach(function (form) {
			setupFormSubmission(form);
		});
	}

	/**
	 * Setup form submission handling
	 * @param {HTMLElement} form The form element
	 */
	function setupFormSubmission(form) {
		form.addEventListener('submit', function (e) {
			e.preventDefault();
			submitRsvp(form);
		});
	}

	/**
	 * Submit RSVP
	 * @param {HTMLElement} form The form element
	 */
	function submitRsvp(form) {
		const container = form.closest('.fair-rsvp-form-container');
		const eventId = container.getAttribute('data-event-id');
		const isAnonymous = container.getAttribute('data-anonymous') === 'true';
		const submitButton = form.querySelector('.fair-rsvp-submit-button');
		const messageContainer = form.querySelector('.fair-rsvp-message');
		const statusDisplay = container.querySelector(
			'.fair-rsvp-current-status'
		);

		// Get selected RSVP status
		const selectedRadio = form.querySelector(
			'input[name="rsvp_status"]:checked'
		);

		if (!selectedRadio) {
			showMessage(
				messageContainer,
				__('Please select an RSVP option.', 'fair-rsvp'),
				'error'
			);
			return;
		}

		const rsvpStatus = selectedRadio.value;

		// Build request data
		const requestData = {
			event_id: parseInt(eventId),
			rsvp_status: rsvpStatus,
		};

		// For anonymous users, add name and email
		if (isAnonymous) {
			const nameInput = form.querySelector('input[name="rsvp_name"]');
			const emailInput = form.querySelector('input[name="rsvp_email"]');

			if (!nameInput || !nameInput.value.trim()) {
				showMessage(
					messageContainer,
					__('Please enter your name.', 'fair-rsvp'),
					'error'
				);
				return;
			}

			if (!emailInput || !emailInput.value.trim()) {
				showMessage(
					messageContainer,
					__('Please enter your email.', 'fair-rsvp'),
					'error'
				);
				return;
			}

			requestData.name = nameInput.value.trim();
			requestData.email = emailInput.value.trim();
		}

		// Disable button and show loading state
		submitButton.disabled = true;
		submitButton.textContent = __('Submitting...', 'fair-rsvp');

		// Check if this is an invitation acceptance
		const invitationToken = container.dataset.invitationToken;
		let apiPath = '/fair-rsvp/v1/rsvp';
		let apiData = requestData;

		if (invitationToken && isAnonymous) {
			// Use invitation accept endpoint
			apiPath = '/fair-rsvp/v1/invitations/accept';
			apiData = {
				token: invitationToken,
				name: requestData.name,
				email: requestData.email,
				rsvp_status: requestData.rsvp_status,
			};
		}

		// Submit to API
		apiFetch({
			path: apiPath,
			method: 'POST',
			data: apiData,
		})
			.then(function (response) {
				// Success message
				let successMessage;
				if (isAnonymous) {
					if (invitationToken) {
						successMessage = __(
							'Thank you! Your invitation has been accepted. An account has been created for you.',
							'fair-rsvp'
						);
					} else {
						successMessage = __(
							'Your RSVP has been submitted successfully! A welcome email with login instructions has been sent to your email address.',
							'fair-rsvp'
						);
					}
				} else {
					successMessage = __(
						'Your RSVP has been updated successfully!',
						'fair-rsvp'
					);
				}

				showMessage(messageContainer, successMessage, 'success');

				// Update status display for logged-in users
				if (!isAnonymous) {
					if (statusDisplay) {
						statusDisplay.innerHTML =
							__('Your current RSVP: ', 'fair-rsvp') +
							'<strong>' +
							translateStatus(rsvpStatus) +
							'</strong>';
					} else {
						// Create status display if it doesn't exist
						const newStatus = document.createElement('p');
						newStatus.className = 'fair-rsvp-current-status';
						newStatus.innerHTML =
							__('Your current RSVP: ', 'fair-rsvp') +
							'<strong>' +
							translateStatus(rsvpStatus) +
							'</strong>';
						container.appendChild(newStatus);
					}

					// Show notification
					showNotification(
						__('RSVP updated successfully!', 'fair-rsvp'),
						'success'
					);
				} else {
					// For anonymous users, show notification and optionally clear form
					showNotification(
						__('RSVP submitted successfully!', 'fair-rsvp'),
						'success'
					);
					form.reset();
				}
			})
			.catch(function (error) {
				console.error('RSVP error:', error);

				let errorMessage = __(
					'Failed to update RSVP. Please try again.',
					'fair-rsvp'
				);

				if (error.message) {
					errorMessage = error.message;
				} else if (error.data && error.data.message) {
					errorMessage = error.data.message;
				}

				showMessage(messageContainer, errorMessage, 'error');
				showNotification(errorMessage, 'error');
			})
			.finally(function () {
				// Re-enable button
				submitButton.disabled = false;
				submitButton.textContent = isAnonymous
					? __('Submit RSVP', 'fair-rsvp')
					: __('Update RSVP', 'fair-rsvp');
			});
	}

	/**
	 * Show message in the form
	 * @param {HTMLElement} container Message container
	 * @param {string} message The message
	 * @param {string} type Message type (success, error)
	 */
	function showMessage(container, message, type) {
		container.textContent = message;
		container.className = 'fair-rsvp-message fair-rsvp-message-' + type;
		container.style.display = 'block';

		// Hide after 5 seconds
		setTimeout(function () {
			container.style.display = 'none';
		}, 5000);
	}

	/**
	 * Show a toast notification
	 * @param {string} message The message
	 * @param {string} type Notification type (success, error)
	 */
	function showNotification(message, type) {
		const notification = document.createElement('div');
		notification.className =
			'fair-rsvp-notification fair-rsvp-notification-' + type;
		notification.textContent = message;

		notification.style.cssText =
			'position: fixed; top: 20px; right: 20px; padding: 15px 20px; border-radius: 4px; color: white; font-weight: 500; z-index: 9999; max-width: 400px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';

		if (type === 'success') {
			notification.style.backgroundColor = '#00a32a';
		} else {
			notification.style.backgroundColor = '#d63638';
		}

		document.body.appendChild(notification);

		setTimeout(function () {
			if (notification.parentNode) {
				notification.parentNode.removeChild(notification);
			}
		}, 5000);
	}

	/**
	 * Translate RSVP status
	 * @param {string} status The status (yes, no, maybe)
	 * @returns {string} Translated status
	 */
	function translateStatus(status) {
		const translations = {
			yes: __('Yes', 'fair-rsvp'),
			no: __('No', 'fair-rsvp'),
			maybe: __('Maybe', 'fair-rsvp'),
		};
		return translations[status.toLowerCase()] || status;
	}

	/**
	 * Initialize invitation functionality
	 */
	function initializeInvitations() {
		const inviteButtons = document.querySelectorAll(
			'.fair-rsvp-invite-button'
		);

		inviteButtons.forEach(function (button) {
			button.addEventListener('click', openInvitationModal);
		});

		// Check for invitation token in URL
		const urlParams = new URLSearchParams(window.location.search);
		const inviteToken = urlParams.get('invite_token');
		if (inviteToken) {
			handleInvitationToken(inviteToken);
		}
	}

	/**
	 * Open invitation modal
	 */
	function openInvitationModal(event) {
		const eventId = event.target.getAttribute('data-event-id');

		// Create modal HTML
		const modalHTML = `
			<div class="fair-rsvp-invite-modal-overlay">
				<div class="fair-rsvp-invite-modal">
					<div class="fair-rsvp-invite-modal-header">
						<h2>${__('Invite a Friend', 'fair-rsvp')}</h2>
						<button type="button" class="fair-rsvp-invite-modal-close">&times;</button>
					</div>
					<div class="fair-rsvp-invite-modal-body">
						<div class="fair-rsvp-invite-tabs">
							<button type="button" class="fair-rsvp-invite-tab active" data-tab="email">
								${__('Send by Email', 'fair-rsvp')}
							</button>
							<button type="button" class="fair-rsvp-invite-tab" data-tab="link">
								${__('Get Link', 'fair-rsvp')}
							</button>
						</div>

						<!-- Email Tab -->
						<div class="fair-rsvp-invite-tab-content active" data-tab-content="email">
							<form class="fair-rsvp-invite-form fair-rsvp-invite-email-form">
								<div>
									<label for="invite-email">${__('Email Address', 'fair-rsvp')}</label>
									<input type="email" id="invite-email" name="email" required placeholder="${__('friend@example.com', 'fair-rsvp')}" />
								</div>
								<div>
									<label for="invite-message">${__('Personal Message (Optional)', 'fair-rsvp')}</label>
									<textarea id="invite-message" name="message" placeholder="${__('Add a personal note...', 'fair-rsvp')}"></textarea>
								</div>
								<div class="fair-rsvp-invite-form-actions">
									<button type="button" class="fair-rsvp-invite-cancel">${__('Cancel', 'fair-rsvp')}</button>
									<button type="submit">${__('Send Invitation', 'fair-rsvp')}</button>
								</div>
								<div class="fair-rsvp-invite-message" style="display: none;"></div>
							</form>
						</div>

						<!-- Link Tab -->
						<div class="fair-rsvp-invite-tab-content" data-tab-content="link">
							<div class="fair-rsvp-invite-link-content">
								<p>${__('Share this link with your friends:', 'fair-rsvp')}</p>
								<button type="button" class="fair-rsvp-generate-link-button">
									${__('Generate Invitation Link', 'fair-rsvp')}
								</button>
								<div class="fair-rsvp-invite-link-display" style="display: none;">
									<div class="fair-rsvp-invite-link-input">
										<input type="text" readonly class="fair-rsvp-invite-link-field" />
										<button type="button" class="fair-rsvp-invite-copy-button">
											${__('Copy', 'fair-rsvp')}
										</button>
									</div>
								</div>
								<div class="fair-rsvp-invite-message" style="display: none;"></div>
							</div>
						</div>
					</div>
				</div>
			</div>
		`;

		// Insert modal into body
		const modalContainer = document.createElement('div');
		modalContainer.innerHTML = modalHTML;
		document.body.appendChild(modalContainer.firstElementChild);

		// Setup modal event listeners
		const modal = document.querySelector('.fair-rsvp-invite-modal-overlay');
		const closeButton = modal.querySelector(
			'.fair-rsvp-invite-modal-close'
		);
		const cancelButtons = modal.querySelectorAll(
			'.fair-rsvp-invite-cancel'
		);
		const tabButtons = modal.querySelectorAll('.fair-rsvp-invite-tab');
		const emailForm = modal.querySelector('.fair-rsvp-invite-email-form');
		const generateLinkButton = modal.querySelector(
			'.fair-rsvp-generate-link-button'
		);
		const copyButton = modal.querySelector('.fair-rsvp-invite-copy-button');

		// Close modal handlers
		closeButton.addEventListener('click', closeInvitationModal);
		cancelButtons.forEach(function (btn) {
			btn.addEventListener('click', closeInvitationModal);
		});
		modal.addEventListener('click', function (e) {
			if (e.target === modal) {
				closeInvitationModal();
			}
		});

		// Tab switching
		tabButtons.forEach(function (button) {
			button.addEventListener('click', function () {
				const tabName = button.getAttribute('data-tab');
				switchInvitationTab(tabName);
			});
		});

		// Email form submission
		emailForm.addEventListener('submit', function (e) {
			e.preventDefault();
			sendEmailInvitation(eventId, emailForm);
		});

		// Generate link button
		generateLinkButton.addEventListener('click', function () {
			generateInvitationLink(eventId);
		});

		// Copy link button
		if (copyButton) {
			copyButton.addEventListener('click', function () {
				const linkField = modal.querySelector(
					'.fair-rsvp-invite-link-field'
				);
				linkField.select();
				document.execCommand('copy');
				copyButton.textContent = __('Copied!', 'fair-rsvp');
				copyButton.classList.add('copied');
				setTimeout(function () {
					copyButton.textContent = __('Copy', 'fair-rsvp');
					copyButton.classList.remove('copied');
				}, 2000);
			});
		}
	}

	/**
	 * Close invitation modal
	 */
	function closeInvitationModal() {
		const modal = document.querySelector('.fair-rsvp-invite-modal-overlay');
		if (modal) {
			modal.remove();
		}
	}

	/**
	 * Switch invitation tabs
	 */
	function switchInvitationTab(tabName) {
		const tabs = document.querySelectorAll('.fair-rsvp-invite-tab');
		const contents = document.querySelectorAll(
			'.fair-rsvp-invite-tab-content'
		);

		tabs.forEach(function (tab) {
			if (tab.getAttribute('data-tab') === tabName) {
				tab.classList.add('active');
			} else {
				tab.classList.remove('active');
			}
		});

		contents.forEach(function (content) {
			if (content.getAttribute('data-tab-content') === tabName) {
				content.classList.add('active');
			} else {
				content.classList.remove('active');
			}
		});
	}

	/**
	 * Send email invitation
	 */
	function sendEmailInvitation(eventId, form) {
		const email = form.querySelector('input[name="email"]').value;
		const message = form.querySelector('textarea[name="message"]').value;
		const submitButton = form.querySelector('button[type="submit"]');
		const messageContainer = form.querySelector(
			'.fair-rsvp-invite-message'
		);

		submitButton.disabled = true;
		submitButton.textContent = __('Sending...', 'fair-rsvp');

		apiFetch({
			path: '/fair-rsvp/v1/invitations/send',
			method: 'POST',
			data: {
				event_id: parseInt(eventId),
				email: email,
				message: message,
			},
		})
			.then(function (response) {
				messageContainer.textContent = __(
					'Invitation sent successfully!',
					'fair-rsvp'
				);
				messageContainer.className = 'fair-rsvp-invite-message success';
				messageContainer.style.display = 'block';
				form.reset();

				setTimeout(function () {
					closeInvitationModal();
				}, 2000);
			})
			.catch(function (error) {
				messageContainer.textContent =
					error.message ||
					__('Failed to send invitation.', 'fair-rsvp');
				messageContainer.className = 'fair-rsvp-invite-message error';
				messageContainer.style.display = 'block';
			})
			.finally(function () {
				submitButton.disabled = false;
				submitButton.textContent = __('Send Invitation', 'fair-rsvp');
			});
	}

	/**
	 * Generate invitation link
	 */
	function generateInvitationLink(eventId) {
		const button = document.querySelector(
			'.fair-rsvp-generate-link-button'
		);
		const linkDisplay = document.querySelector(
			'.fair-rsvp-invite-link-display'
		);
		const linkField = document.querySelector(
			'.fair-rsvp-invite-link-field'
		);
		const messageContainer = document.querySelector(
			'.fair-rsvp-invite-tab-content[data-tab-content="link"] .fair-rsvp-invite-message'
		);

		button.disabled = true;
		button.textContent = __('Generating...', 'fair-rsvp');

		apiFetch({
			path: '/fair-rsvp/v1/invitations/generate-link',
			method: 'POST',
			data: {
				event_id: parseInt(eventId),
			},
		})
			.then(function (response) {
				linkField.value = response.invitation_url;
				linkDisplay.style.display = 'block';
				button.style.display = 'none';

				messageContainer.textContent = __(
					'Link generated! Share it with your friends.',
					'fair-rsvp'
				);
				messageContainer.className = 'fair-rsvp-invite-message success';
				messageContainer.style.display = 'block';
			})
			.catch(function (error) {
				messageContainer.textContent =
					error.message ||
					__('Failed to generate link.', 'fair-rsvp');
				messageContainer.className = 'fair-rsvp-invite-message error';
				messageContainer.style.display = 'block';
			})
			.finally(function () {
				button.disabled = false;
				button.textContent = __(
					'Generate Invitation Link',
					'fair-rsvp'
				);
			});
	}

	/**
	 * Handle invitation token in URL
	 */
	function handleInvitationToken(token) {
		// Validate token first
		apiFetch({
			path: `/fair-rsvp/v1/invitations/validate?token=${token}`,
		})
			.then(function (response) {
				if (response.valid) {
					// Check if user is logged in
					const isLoggedIn =
						document.body.classList.contains('logged-in');

					if (isLoggedIn) {
						// Logged in user - just show success message
						showNotification(
							__(
								'You have been invited to this event!',
								'fair-rsvp'
							),
							'success'
						);
					} else {
						// Anonymous user - show invitation acceptance form
						showInvitationAcceptanceForm(token, response);
					}
				}
			})
			.catch(function (error) {
				showNotification(
					error.message ||
						__('Invalid invitation link.', 'fair-rsvp'),
					'error'
				);
			});
	}

	/**
	 * Show invitation acceptance form for anonymous users
	 */
	function showInvitationAcceptanceForm(token, invitationData) {
		// Find existing form containers
		const existingForms = document.querySelectorAll(
			'.fair-rsvp-form-container'
		);
		const loginMessage = document.querySelector('.fair-rsvp-login-message');
		const notAllowedMessage = document.querySelector(
			'.fair-rsvp-not-allowed-message'
		);

		// Hide login or not-allowed messages if they exist
		if (loginMessage) {
			loginMessage.style.display = 'none';
		}
		if (notAllowedMessage) {
			notAllowedMessage.style.display = 'none';
		}

		// If there's already an anonymous form, use it with invitation token
		if (existingForms.length > 0) {
			const form = existingForms[0];
			form.dataset.invitationToken = token;

			// Add invited banner
			const banner = document.createElement('div');
			banner.className = 'fair-rsvp-invited-banner';
			banner.innerHTML =
				'<p>' +
				__("You're invited to this event!", 'fair-rsvp') +
				'</p>';
			form.parentNode.insertBefore(banner, form);

			showNotification(
				__(
					'Please fill out the form below to accept your invitation.',
					'fair-rsvp'
				),
				'success'
			);
			return;
		}

		// Create new invitation acceptance form
		const rsvpButton = document.querySelector('.fair-rsvp-button');
		if (!rsvpButton) return;

		const formHTML = `
			<div class="fair-rsvp-invited-banner">
				<p>${__("You're invited to this event!", 'fair-rsvp')}</p>
			</div>
			<div class="fair-rsvp-form-container fair-rsvp-invitation-form" data-invitation-token="${token}">
				<form class="fair-rsvp-form">
					<div class="fair-rsvp-user-info">
						<div class="fair-rsvp-field">
							<label for="fair-rsvp-invitation-name">
								${__('Your Name', 'fair-rsvp')} <span class="required">*</span>
							</label>
							<input
								type="text"
								id="fair-rsvp-invitation-name"
								name="rsvp_name"
								class="fair-rsvp-input"
								required
								placeholder="${__('Enter your name', 'fair-rsvp')}"
							/>
						</div>
						<div class="fair-rsvp-field">
							<label for="fair-rsvp-invitation-email">
								${__('Your Email', 'fair-rsvp')} <span class="required">*</span>
							</label>
							<input
								type="email"
								id="fair-rsvp-invitation-email"
								name="rsvp_email"
								class="fair-rsvp-input"
								required
								placeholder="${__('Enter your email', 'fair-rsvp')}"
							/>
						</div>
					</div>

					<div class="fair-rsvp-options">
						<label class="fair-rsvp-option">
							<input
								type="radio"
								name="rsvp_status"
								value="yes"
								required
							/>
							<span>${__('Yes', 'fair-rsvp')}</span>
						</label>

						<label class="fair-rsvp-option">
							<input
								type="radio"
								name="rsvp_status"
								value="maybe"
							/>
							<span>${__('Maybe', 'fair-rsvp')}</span>
						</label>

						<label class="fair-rsvp-option">
							<input
								type="radio"
								name="rsvp_status"
								value="no"
							/>
							<span>${__('No', 'fair-rsvp')}</span>
						</label>
					</div>

					<button type="submit" class="fair-rsvp-submit-button">
						${__('Accept Invitation', 'fair-rsvp')}
					</button>

					<div class="fair-rsvp-message" style="display: none;"></div>
				</form>
			</div>
		`;

		rsvpButton.innerHTML = formHTML;

		// Attach event handler to the new form
		const newForm = rsvpButton.querySelector(
			'.fair-rsvp-invitation-form form'
		);
		if (newForm) {
			newForm.addEventListener('submit', handleInvitationFormSubmit);
		}
	}

	/**
	 * Handle invitation acceptance form submission
	 */
	function handleInvitationFormSubmit(e) {
		e.preventDefault();

		const form = e.target;
		const container = form.closest('.fair-rsvp-form-container');
		const token = container.dataset.invitationToken;
		const messageContainer = form.querySelector('.fair-rsvp-message');
		const submitButton = form.querySelector('.fair-rsvp-submit-button');

		// Get form data
		const formData = new FormData(form);
		const name = formData.get('rsvp_name');
		const email = formData.get('rsvp_email');
		const rsvpStatus = formData.get('rsvp_status');

		if (!rsvpStatus) {
			messageContainer.textContent = __(
				'Please select your RSVP status.',
				'fair-rsvp'
			);
			messageContainer.className =
				'fair-rsvp-message fair-rsvp-message-error';
			messageContainer.style.display = 'block';
			return;
		}

		// Disable button
		submitButton.disabled = true;
		submitButton.textContent = __('Submitting...', 'fair-rsvp');

		// Submit to invitation accept endpoint
		apiFetch({
			path: '/fair-rsvp/v1/invitations/accept',
			method: 'POST',
			data: {
				token: token,
				name: name,
				email: email,
				rsvp_status: rsvpStatus,
			},
		})
			.then(function (response) {
				messageContainer.textContent = __(
					'Thank you! Your invitation has been accepted. An account has been created for you.',
					'fair-rsvp'
				);
				messageContainer.className =
					'fair-rsvp-message fair-rsvp-message-success';
				messageContainer.style.display = 'block';

				// Hide form after successful submission
				setTimeout(function () {
					form.style.display = 'none';
				}, 3000);
			})
			.catch(function (error) {
				messageContainer.textContent =
					error.message ||
					__('Failed to accept invitation.', 'fair-rsvp');
				messageContainer.className =
					'fair-rsvp-message fair-rsvp-message-error';
				messageContainer.style.display = 'block';
			})
			.finally(function () {
				submitButton.disabled = false;
				submitButton.textContent = __('Accept Invitation', 'fair-rsvp');
			});
	}

	// Initialize invitations after DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initializeInvitations);
	} else {
		initializeInvitations();
	}
})();
