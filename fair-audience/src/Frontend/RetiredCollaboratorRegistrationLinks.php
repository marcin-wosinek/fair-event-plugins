<?php
/**
 * Retired collaborator registration links
 *
 * @package FairAudience
 */

namespace FairAudience\Frontend;

defined( 'WPINC' ) || die;

/**
 * Answers links to the removed collaborator registration form with 410 Gone.
 *
 * Covers the `?collaborator_profile=1` links the Collaborators page shared.
 * No submission is read, so no participant, confirmation token or email is
 * created: the presence of the parameter is enough. Runs before any other
 * `template_redirect` handler, so an older fair-audience-experimental that
 * still serves the form never gets to it.
 */
class RetiredCollaboratorRegistrationLinks {

	/**
	 * Initialize hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_filter( 'query_vars', array( __CLASS__, 'add_query_vars' ) );
		add_action( 'template_redirect', array( __CLASS__, 'handle_request' ), 0 );
	}

	/**
	 * Register the retired query variable so WordPress parses it.
	 *
	 * @param array $vars Query variables.
	 * @return array Modified query variables.
	 */
	public static function add_query_vars( $vars ) {
		$vars[] = 'collaborator_profile';
		return $vars;
	}

	/**
	 * Whether the current request targets a retired registration link.
	 *
	 * @return bool
	 */
	public static function is_retired_registration_request() {
		return '' !== (string) get_query_var( 'collaborator_profile' );
	}

	/**
	 * Stop retired registration requests with a 410 page.
	 *
	 * @return void
	 */
	public static function handle_request() {
		if ( ! self::is_retired_registration_request() ) {
			return;
		}

		nocache_headers();
		wp_die(
			esc_html__( 'Collaborator registration is no longer available.', 'fair-audience' ),
			esc_html__( 'Collaborator registration removed', 'fair-audience' ),
			array( 'response' => 410 )
		);
	}
}
