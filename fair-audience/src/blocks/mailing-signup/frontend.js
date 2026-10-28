import './style.css';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import {
	extractErrorMessage,
	showNotification,
	showMessage,
	setButtonLoading,
	onDomReady,
	wireNotYouButton,
} from 'fair-events-shared/src/form-utils.js';
import {
	createWeeklyState,
	setWeeklyChecked,
	setFeedSelected,
	weeklyError,
	weeklyRequestData,
	responseNotice,
} from './signupModel.js';

/**
 * Frontend JavaScript for Fair Audience Mailing Signup
 *
 * @package FairAudience
 */

const CSS_PREFIX = 'fair-audience-mailing';

( function () {
	'use strict';

	onDomReady( initializeMailingSignupForms );

	/**
	 * Initialize all mailing signup forms on the page
	 */
	function initializeMailingSignupForms() {
		const forms = document.querySelectorAll(
			'.fair-audience-mailing-form'
		);

		forms.forEach( function ( form ) {
			setupForm( form );
			wireNotYouButton( form.querySelector( '.fair-audience-not-you' ) );
		} );
	}

	/**
	 * Read the weekly-update state the server rendered into the form.
	 *
	 * @param {HTMLElement} form The form element
	 * @return {Object|null} Weekly state
	 */
	function readWeeklyState( form ) {
		const fieldset = form.querySelector( '.fair-audience-mailing-weekly' );
		if ( ! fieldset ) {
			return null;
		}
		const checkbox = fieldset.querySelector(
			'input[name="mailing_weekly"]'
		);

		return createWeeklyState( {
			config: fieldset.dataset.weeklyConfig,
			feedMode: fieldset.dataset.weeklyFeeds,
			offered: !! checkbox,
			checked: checkbox ? checkbox.defaultChecked : false,
		} );
	}

	/**
	 * Keep one state model per form and update it from its controls.
	 *
	 * @param {HTMLElement} form The form element
	 */
	function setupForm( form ) {
		const state = {
			weekly: readWeeklyState( form ),
			submitting: false,
		};

		form.addEventListener( 'change', function ( e ) {
			const input = e.target;
			if ( ! state.weekly ) {
				return;
			}
			if ( input.name === 'mailing_weekly' ) {
				state.weekly = setWeeklyChecked( state.weekly, input.checked );
			} else if ( input.name === 'mailing_weekly_feeds[]' ) {
				state.weekly = setFeedSelected(
					state.weekly,
					parseInt( input.value, 10 ),
					input.checked
				);
			}
		} );

		form.addEventListener( 'submit', function ( e ) {
			e.preventDefault();
			if ( state.submitting ) {
				return;
			}
			submitSignup( form, state );
		} );
	}

	/**
	 * Submit signup
	 * @param {HTMLElement} form  The form element
	 * @param {Object}      state The form's state model
	 */
	function submitSignup( form, state ) {
		const container = form.closest( '.fair-audience-mailing-signup' );
		const submitButton = form.querySelector(
			'.fair-audience-mailing-submit-button'
		);
		const messageContainer = form.querySelector(
			'.fair-audience-mailing-message'
		);
		const successMessage =
			container.dataset.successMessage ||
			__(
				'Please check your email to confirm your subscription.',
				'fair-audience'
			);

		// Get form data
		const nameInput = form.querySelector( 'input[name="mailing_name"]' );
		const surnameInput = form.querySelector(
			'input[name="mailing_surname"]'
		);
		const emailInput = form.querySelector( 'input[name="mailing_email"]' );

		// Validate inputs
		if ( ! nameInput || ! nameInput.value.trim() ) {
			showMessage(
				messageContainer,
				__( 'Please enter your first name.', 'fair-audience' ),
				'error',
				CSS_PREFIX
			);
			return;
		}

		if ( ! surnameInput || ! surnameInput.value.trim() ) {
			showMessage(
				messageContainer,
				__( 'Please enter your last name.', 'fair-audience' ),
				'error',
				CSS_PREFIX
			);
			return;
		}

		if ( ! emailInput || ! emailInput.value.trim() ) {
			showMessage(
				messageContainer,
				__( 'Please enter your email.', 'fair-audience' ),
				'error',
				CSS_PREFIX
			);
			return;
		}

		const weeklyMessage = weeklyError( state.weekly );
		if ( weeklyMessage ) {
			showMessage( messageContainer, weeklyMessage, 'error', CSS_PREFIX );
			return;
		}

		// Collect selected category IDs
		const categoryCheckboxes = form.querySelectorAll(
			'input[name="mailing_categories[]"]:checked'
		);
		const categoryIds = Array.from( categoryCheckboxes ).map( ( cb ) =>
			parseInt( cb.value, 10 )
		);

		// Build request data
		const requestData = {
			name: nameInput.value.trim(),
			surname: surnameInput.value.trim(),
			email: emailInput.value.trim(),
			category_ids: categoryIds,
			...weeklyRequestData( state.weekly ),
		};

		// Disable button and show loading state
		state.submitting = true;
		const restoreButton = setButtonLoading(
			submitButton,
			__( 'Submitting...', 'fair-audience' )
		);

		// Submit to API
		apiFetch( {
			path: '/fair-audience/v1/mailing-signup',
			method: 'POST',
			data: requestData,
		} )
			.then( function ( response ) {
				const notice = responseNotice( response, successMessage );

				showMessage(
					messageContainer,
					notice.message,
					notice.type,
					CSS_PREFIX
				);
				if ( notice.reset ) {
					// Clear form on new signup
					form.reset();
					state.weekly = readWeeklyState( form );
				}

				// Show notification
				showNotification( notice.message, 'success' );
			} )
			.catch( function ( error ) {
				console.error( 'Mailing signup error:', error );

				const errorMessage = extractErrorMessage(
					error,
					__(
						'Failed to process signup. Please try again.',
						'fair-audience'
					)
				);

				showMessage(
					messageContainer,
					errorMessage,
					'error',
					CSS_PREFIX
				);
				showNotification( errorMessage, 'error' );
			} )
			.finally( function () {
				state.submitting = false;
				restoreButton();
			} );
	}
} )();
