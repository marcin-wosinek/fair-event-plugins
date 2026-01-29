<?php
/**
 * Manage Subscription Template
 *
 * @package FairAudience
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in templates are scoped and don't need prefixing.
 */

defined( 'WPINC' ) || die;

use FairAudience\Services\ManageSubscriptionToken;
use FairAudience\Database\ParticipantRepository;

// Get the token from the query var.
$token = sanitize_text_field( get_query_var( 'manage_subscription' ) );

// Initialize repository.
$participant_repository = new ParticipantRepository();

// Process the request.
$result      = array(
	'success'     => false,
	'message'     => '',
	'type'        => 'error',
	'participant' => null,
);

// Verify token.
$participant_id = ManageSubscriptionToken::verify( $token );

if ( false === $participant_id ) {
	$result['message'] = __( 'Invalid or expired link. Please use the link from your email.', 'fair-audience' );
} else {
	// Get participant.
	$participant = $participant_repository->get_by_id( $participant_id );

	if ( ! $participant ) {
		$result['message'] = __( 'Subscriber not found.', 'fair-audience' );
	} else {
		$result['success']     = true;
		$result['participant'] = $participant;

		// Handle form submission.
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- Public form, token provides auth.
		if ( 'POST' === $_SERVER['REQUEST_METHOD'] && isset( $_POST['email_profile'] ) ) {
			// phpcs:ignore WordPress.Security.NonceVerification.Missing -- Public form, token provides auth.
			$new_profile = sanitize_text_field( wp_unslash( $_POST['email_profile'] ) );

			if ( in_array( $new_profile, array( 'minimal', 'marketing' ), true ) ) {
				$participant->email_profile = $new_profile;

				if ( $participant->save() ) {
					$result['type']    = 'success';
					$result['message'] = __( 'Your preferences have been updated.', 'fair-audience' );
				} else {
					$result['type']    = 'error';
					$result['message'] = __( 'Failed to update preferences. Please try again.', 'fair-audience' );
				}
			}
		}
	}
}

get_header();
?>

<style>
	.fair-audience-subscription-container {
		max-width: 600px;
		margin: 60px auto;
		padding: 40px 20px;
	}

	.fair-audience-subscription-box {
		background: #fff;
		border-radius: 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		padding: 40px;
	}

	.fair-audience-subscription-title {
		font-size: 24px;
		font-weight: 600;
		margin-bottom: 8px;
		color: #1e1e1e;
		text-align: center;
	}

	.fair-audience-subscription-subtitle {
		font-size: 14px;
		color: #757575;
		margin-bottom: 24px;
		text-align: center;
	}

	.fair-audience-subscription-message {
		padding: 12px 16px;
		border-radius: 4px;
		margin-bottom: 24px;
		font-size: 14px;
	}

	.fair-audience-subscription-message.success {
		background: #d4edda;
		color: #155724;
		border: 1px solid #c3e6cb;
	}

	.fair-audience-subscription-message.error {
		background: #f8d7da;
		color: #721c24;
		border: 1px solid #f5c6cb;
	}

	.fair-audience-subscription-options {
		margin-bottom: 24px;
	}

	.fair-audience-subscription-option {
		display: flex;
		align-items: flex-start;
		padding: 16px;
		border: 2px solid #e0e0e0;
		border-radius: 8px;
		margin-bottom: 12px;
		cursor: pointer;
		transition: border-color 0.2s, background-color 0.2s;
	}

	.fair-audience-subscription-option:hover {
		border-color: #0073aa;
		background-color: #f8f9fa;
	}

	.fair-audience-subscription-option.selected {
		border-color: #0073aa;
		background-color: #e7f3ff;
	}

	.fair-audience-subscription-option input[type="radio"] {
		margin-right: 12px;
		margin-top: 3px;
		flex-shrink: 0;
	}

	.fair-audience-subscription-option-content {
		flex: 1;
	}

	.fair-audience-subscription-option-title {
		font-weight: 600;
		color: #1e1e1e;
		margin-bottom: 4px;
	}

	.fair-audience-subscription-option-description {
		font-size: 14px;
		color: #757575;
		line-height: 1.5;
	}

	.fair-audience-subscription-submit {
		display: block;
		width: 100%;
		background-color: #0073aa;
		color: #fff;
		border: none;
		padding: 14px 24px;
		border-radius: 4px;
		font-size: 16px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.fair-audience-subscription-submit:hover {
		background-color: #005a87;
	}

	.fair-audience-subscription-footer {
		margin-top: 24px;
		text-align: center;
	}

	.fair-audience-subscription-link {
		color: #0073aa;
		text-decoration: none;
	}

	.fair-audience-subscription-link:hover {
		text-decoration: underline;
	}

	.fair-audience-error-container {
		text-align: center;
	}

	.fair-audience-error-icon {
		font-size: 48px;
		color: #d63638;
		margin-bottom: 20px;
	}
</style>

<div class="fair-audience-subscription-container">
	<div class="fair-audience-subscription-box">
		<?php if ( ! $result['success'] ) : ?>
			<div class="fair-audience-error-container">
				<div class="fair-audience-error-icon">&#10007;</div>
				<h1 class="fair-audience-subscription-title">
					<?php echo esc_html__( 'Invalid Link', 'fair-audience' ); ?>
				</h1>
				<p class="fair-audience-subscription-message error">
					<?php echo esc_html( $result['message'] ); ?>
				</p>
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-subscription-link">
					<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
				</a>
			</div>
		<?php else : ?>
			<h1 class="fair-audience-subscription-title">
				<?php echo esc_html__( 'Manage Your Subscription', 'fair-audience' ); ?>
			</h1>
			<p class="fair-audience-subscription-subtitle">
				<?php echo esc_html( $result['participant']->email ); ?>
			</p>

			<?php if ( ! empty( $result['message'] ) ) : ?>
				<div class="fair-audience-subscription-message <?php echo esc_attr( $result['type'] ); ?>">
					<?php echo esc_html( $result['message'] ); ?>
				</div>
			<?php endif; ?>

			<form method="post">
				<div class="fair-audience-subscription-options">
					<label class="fair-audience-subscription-option <?php echo 'marketing' === $result['participant']->email_profile ? 'selected' : ''; ?>">
						<input type="radio" name="email_profile" value="marketing" <?php checked( $result['participant']->email_profile, 'marketing' ); ?>>
						<div class="fair-audience-subscription-option-content">
							<div class="fair-audience-subscription-option-title">
								<?php echo esc_html__( 'All emails', 'fair-audience' ); ?>
							</div>
							<div class="fair-audience-subscription-option-description">
								<?php echo esc_html__( 'Receive event invitations, photos, polls, and other updates.', 'fair-audience' ); ?>
							</div>
						</div>
					</label>

					<label class="fair-audience-subscription-option <?php echo 'minimal' === $result['participant']->email_profile ? 'selected' : ''; ?>">
						<input type="radio" name="email_profile" value="minimal" <?php checked( $result['participant']->email_profile, 'minimal' ); ?>>
						<div class="fair-audience-subscription-option-content">
							<div class="fair-audience-subscription-option-title">
								<?php echo esc_html__( 'Essential emails only', 'fair-audience' ); ?>
							</div>
							<div class="fair-audience-subscription-option-description">
								<?php echo esc_html__( 'Only receive emails about events you signed up for (photos, polls, confirmations). No promotional emails.', 'fair-audience' ); ?>
							</div>
						</div>
					</label>
				</div>

				<button type="submit" class="fair-audience-subscription-submit">
					<?php echo esc_html__( 'Save Preferences', 'fair-audience' ); ?>
				</button>
			</form>

			<div class="fair-audience-subscription-footer">
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-subscription-link">
					<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
				</a>
			</div>
		<?php endif; ?>
	</div>
</div>

<script>
	document.addEventListener('DOMContentLoaded', function() {
		var options = document.querySelectorAll('.fair-audience-subscription-option');
		options.forEach(function(option) {
			var radio = option.querySelector('input[type="radio"]');
			radio.addEventListener('change', function() {
				options.forEach(function(opt) {
					opt.classList.remove('selected');
				});
				if (radio.checked) {
					option.classList.add('selected');
				}
			});
		});
	});
</script>

<?php
get_footer();
?>
