<?php
/**
 * Email Confirmation Renderer
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Prints the public page the confirmation email's link opens, for the
 * outcome of {@see EmailConfirmation::confirm()}.
 */
class EmailConfirmationRenderer {

	/**
	 * Print the whole page.
	 *
	 * @param string $outcome One of the EmailConfirmation outcome constants.
	 * @return void
	 */
	public static function render( string $outcome ) {
		list( $type, $message ) = self::result( $outcome );
		$site_name              = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
		?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title><?php echo esc_html( $site_name ); ?></title>
		<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>

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
		<div class="fair-audience-confirmation-icon <?php echo esc_attr( $type ); ?>">
			<?php if ( 'success' === $type ) : ?>
				&#10003;
			<?php elseif ( 'info' === $type ) : ?>
				&#8505;
			<?php else : ?>
				&#10007;
			<?php endif; ?>
		</div>

		<h1 class="fair-audience-confirmation-title">
			<?php
			if ( 'success' === $type ) {
				echo esc_html__( 'Email Confirmed!', 'fair-audience' );
			} elseif ( 'info' === $type ) {
				echo esc_html__( 'Already Confirmed', 'fair-audience' );
			} else {
				echo esc_html__( 'Confirmation Failed', 'fair-audience' );
			}
			?>
		</h1>

		<p class="fair-audience-confirmation-message">
			<?php echo esc_html( $message ); ?>
		</p>

		<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-confirmation-link">
			<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
		</a>
	</div>
</div>

		<?php wp_footer(); ?>
</body>
</html>
		<?php
	}

	/**
	 * Notice type and message for an outcome.
	 *
	 * @param string $outcome One of the EmailConfirmation outcome constants.
	 * @return string[] Type ('success', 'info' or 'error') and message.
	 */
	public static function result( string $outcome ): array {
		switch ( $outcome ) {
			case EmailConfirmation::CONFIRMED:
				return array( 'success', __( 'Your email has been confirmed. Welcome to our mailing list!', 'fair-audience' ) );
			case EmailConfirmation::ALREADY_CONFIRMED:
				return array( 'info', __( 'Your email is already confirmed!', 'fair-audience' ) );
			case EmailConfirmation::TOKEN_EXPIRED:
				return array( 'error', __( 'This confirmation link has expired. Please sign up again.', 'fair-audience' ) );
			case EmailConfirmation::PARTICIPANT_NOT_FOUND:
				return array( 'error', __( 'Invalid confirmation link. Please sign up again.', 'fair-audience' ) );
			case EmailConfirmation::UPDATE_FAILED:
				return array( 'error', __( 'Failed to confirm your email. Please try again.', 'fair-audience' ) );
			default:
				return array( 'error', __( 'Invalid or expired confirmation link. Please sign up again.', 'fair-audience' ) );
		}
	}
}
