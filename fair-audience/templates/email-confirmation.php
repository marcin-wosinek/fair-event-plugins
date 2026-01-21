<?php
/**
 * Email Confirmation Template
 *
 * @package FairAudience
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in templates are scoped and don't need prefixing.
 */

defined( 'WPINC' ) || die;

use FairAudience\Database\EmailConfirmationTokenRepository;
use FairAudience\Database\ParticipantRepository;

// Get the token from the query var.
$token_string = sanitize_text_field( get_query_var( 'confirm_email_key' ) );

// Initialize repositories.
$token_repository       = new EmailConfirmationTokenRepository();
$participant_repository = new ParticipantRepository();

// Process the confirmation.
$result        = array(
	'success' => false,
	'message' => '',
	'type'    => 'error',
);

if ( empty( $token_string ) ) {
	$result['message'] = __( 'Invalid confirmation link.', 'fair-audience' );
} else {
	// Get token.
	$token = $token_repository->get_by_token( $token_string );

	if ( ! $token ) {
		$result['message'] = __( 'Invalid or expired confirmation link. Please sign up again.', 'fair-audience' );
	} elseif ( $token->is_expired() ) {
		// Delete expired token.
		$token->delete();
		$result['message'] = __( 'This confirmation link has expired. Please sign up again.', 'fair-audience' );
	} else {
		// Get participant.
		$participant = $participant_repository->get_by_id( $token->participant_id );

		if ( ! $participant ) {
			// Clean up orphaned token.
			$token->delete();
			$result['message'] = __( 'Invalid confirmation link. Please sign up again.', 'fair-audience' );
		} elseif ( 'confirmed' === $participant->status ) {
			// Already confirmed.
			$token->delete();
			$result['success'] = true;
			$result['message'] = __( 'Your email is already confirmed!', 'fair-audience' );
			$result['type']    = 'info';
		} else {
			// Update participant status to confirmed and set email profile to in_the_loop.
			$participant->status        = 'confirmed';
			$participant->email_profile = 'in_the_loop';

			if ( $participant->save() ) {
				// Delete the token (one-time use).
				$token->delete();

				$result['success'] = true;
				$result['message'] = __( 'Your email has been confirmed. Welcome to our mailing list!', 'fair-audience' );
				$result['type']    = 'success';
			} else {
				$result['message'] = __( 'Failed to confirm your email. Please try again.', 'fair-audience' );
			}
		}
	}
}

get_header();
?>

<style>
	.fair-audience-confirmation-container {
		max-width: 600px;
		margin: 60px auto;
		padding: 40px;
		text-align: center;
	}

	.fair-audience-confirmation-box {
		background: #fff;
		border-radius: 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		padding: 40px;
	}

	.fair-audience-confirmation-icon {
		font-size: 48px;
		margin-bottom: 20px;
	}

	.fair-audience-confirmation-icon.success {
		color: #00a32a;
	}

	.fair-audience-confirmation-icon.error {
		color: #d63638;
	}

	.fair-audience-confirmation-icon.info {
		color: #0073aa;
	}

	.fair-audience-confirmation-title {
		font-size: 24px;
		font-weight: 600;
		margin-bottom: 16px;
		color: #1e1e1e;
	}

	.fair-audience-confirmation-message {
		font-size: 16px;
		color: #50575e;
		line-height: 1.6;
		margin-bottom: 24px;
	}

	.fair-audience-confirmation-link {
		display: inline-block;
		background-color: #0073aa;
		color: #fff;
		text-decoration: none;
		padding: 12px 24px;
		border-radius: 4px;
		font-weight: 500;
		transition: background-color 0.2s;
	}

	.fair-audience-confirmation-link:hover {
		background-color: #005a87;
		color: #fff;
	}
</style>

<div class="fair-audience-confirmation-container">
	<div class="fair-audience-confirmation-box">
		<div class="fair-audience-confirmation-icon <?php echo esc_attr( $result['type'] ); ?>">
			<?php if ( 'success' === $result['type'] ) : ?>
				&#10003;
			<?php elseif ( 'info' === $result['type'] ) : ?>
				&#8505;
			<?php else : ?>
				&#10007;
			<?php endif; ?>
		</div>

		<h1 class="fair-audience-confirmation-title">
			<?php
			if ( 'success' === $result['type'] ) {
				echo esc_html__( 'Email Confirmed!', 'fair-audience' );
			} elseif ( 'info' === $result['type'] ) {
				echo esc_html__( 'Already Confirmed', 'fair-audience' );
			} else {
				echo esc_html__( 'Confirmation Failed', 'fair-audience' );
			}
			?>
		</h1>

		<p class="fair-audience-confirmation-message">
			<?php echo esc_html( $result['message'] ); ?>
		</p>

		<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-confirmation-link">
			<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
		</a>
	</div>
</div>

<?php
get_footer();
?>
