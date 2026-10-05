<?php
/**
 * Plugin Name: Fair Audience E2E Event Signup
 * Description: Test-only routes for the fair-audience event-signup API
 *              specs, loaded ONLY inside the Playwright wp-env instance.
 *              Renders stored block content on an event page (optionally
 *              without the fair-events Event Signup block), reads the link
 *              from a captured "continue registering" email, and issues a
 *              participant token.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'rest_api_init',
	static function () {
		if ( ! class_exists( '\FairAudience\Services\ParticipantToken' ) ) {
			return;
		}

		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		// Render block content the way an event page would, and report how
		// the fair-audience/event-signup name is registered.
		register_rest_route(
			'fair-e2e/v1',
			'/event-signup/render',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					$post = get_post( absint( $request->get_param( 'post_id' ) ) );
					if ( ! $post ) {
						return new WP_Error( 'not_found', 'Post not found.', array( 'status' => 404 ) );
					}

					$registry = WP_Block_Type_Registry::get_instance();
					if ( $request->get_param( 'without_unified' ) && $registry->is_registered( 'fair-events/event-signup' ) ) {
						$registry->unregister( 'fair-events/event-signup' );
					}

					$GLOBALS['post'] = $post; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only render context.
					setup_postdata( $post );
					$html = do_blocks( (string) $request->get_param( 'content' ) );
					wp_reset_postdata();

					$alias = $registry->get_registered( 'fair-audience/event-signup' );

					return rest_ensure_response(
						array(
							'html'  => $html,
							'alias' => $alias
								? array(
									'inserter'       => $alias->supports['inserter'] ?? null,
									'editor_scripts' => $alias->editor_script_handles,
									'view_scripts'   => $alias->view_script_handles,
									'scripts'        => $alias->script_handles,
									'styles'         => $alias->style_handles,
									'editor_styles'  => $alias->editor_style_handles,
								)
								: null,
						)
					);
				},
			)
		);

		// The link in the latest "continue registering" email captured for
		// an address — the only place its single-use token ever appears.
		register_rest_route(
			'fair-e2e/v1',
			'/event-signup/resume-link',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					$email = sanitize_email( (string) $request->get_param( 'email' ) );
					$found = array();
					foreach ( get_option( 'fair_e2e_captured_mail', array() ) as $entry ) {
						if ( ! in_array( $email, (array) ( $entry['to'] ?? array() ), true ) ) {
							continue;
						}
						$body = html_entity_decode( (string) ( $entry['body'] ?? '' ) );
						if ( preg_match( '/participant_token=([^"&#\s]+)/', $body, $token ) && preg_match( '/[?&]resume=([^"&#\s]+)/', $body, $resume ) ) {
							$found[] = array(
								'participant_token' => $token[1],
								'resume'            => $resume[1],
							);
						}
					}

					return rest_ensure_response(
						array(
							'count' => count( $found ),
							'link'  => $found ? end( $found ) : null,
						)
					);
				},
			)
		);

		// A participant token, as an emailed signup link would carry.
		register_rest_route(
			'fair-e2e/v1',
			'/event-signup/participant-token',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					return rest_ensure_response(
						array(
							'token' => \FairAudience\Services\ParticipantToken::generate(
								absint( $request->get_param( 'participant_id' ) ),
								absint( $request->get_param( 'event_date_id' ) )
							),
						)
					);
				},
			)
		);
	}
);
