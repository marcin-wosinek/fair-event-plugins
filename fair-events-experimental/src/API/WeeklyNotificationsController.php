<?php
/**
 * Weekly event notifications administrator REST API.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEventsExperimental\Settings\WeeklyNotificationSettings;
use FairEventsExperimental\WeeklyNotifications\DeliveryLog;
use FairEventsExperimental\WeeklyNotifications\Dispatcher;
use FairEventsExperimental\WeeklyNotifications\Providers;
use FairEventsExperimental\WeeklyNotifications\SummaryBuilder;
use FairEventsExperimental\WeeklyNotifications\TelegramProvider;
use FairEventsExperimental\WeeklyNotifications\WeekSchedule;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Settings, preview and test-send routes for weekly event notifications.
 *
 * The Telegram bot token is write-only: responses report only whether one is
 * saved, and provider errors are returned with the token removed.
 */
class WeeklyNotificationsController extends WP_REST_Controller {

	/**
	 * Route namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events-experimental/v1';

	/**
	 * Route base.
	 *
	 * @var string
	 */
	protected $rest_base = 'weekly-notifications';

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'enabled'            => array( 'type' => 'boolean' ),
						'source_slug'        => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_key',
						),
						'page_id'            => array(
							'type'    => 'integer',
							'minimum' => 0,
						),
						'day_of_week'        => array(
							'type'    => 'integer',
							'minimum' => 1,
							'maximum' => 7,
						),
						'time_of_day'        => array(
							'type'              => 'string',
							'validate_callback' => array( $this, 'validate_time' ),
						),
						'week_scope'         => array(
							'type' => 'string',
							'enum' => WeeklyNotificationSettings::WEEK_SCOPES,
						),
						'telegram_enabled'   => array( 'type' => 'boolean' ),
						'telegram_chat_ids'  => array(
							'type'  => array( 'array', 'string' ),
							'items' => array( 'type' => 'string' ),
						),
						'telegram_bot_token' => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/telegram-token',
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => array( $this, 'clear_token' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/preview',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_preview' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'send_test' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);
	}

	/**
	 * Only administrators manage notifications.
	 *
	 * @return bool|WP_Error
	 */
	public function permissions_check() {
		if ( current_user_can( 'manage_options' ) ) {
			return true;
		}

		return new WP_Error(
			'rest_forbidden',
			__( 'You do not have permission to manage weekly notifications.', 'fair-events-experimental' ),
			array( 'status' => is_user_logged_in() ? 403 : 401 )
		);
	}

	/**
	 * Validate a 'HH:MM' time.
	 *
	 * @param mixed $value Time.
	 * @return true|WP_Error
	 */
	public function validate_time( $value ) {
		return WeeklyNotificationSettings::valid_time( $value )
			? true
			: new WP_Error( 'invalid_time', __( 'Enter the send time as HH:MM, for example 09:00.', 'fair-events-experimental' ), array( 'status' => 400 ) );
	}

	/**
	 * Read settings and delivery status.
	 *
	 * @param WP_REST_Request|null $request Request, unused.
	 * @return \WP_REST_Response
	 */
	public function get_item( $request = null ) {
		unset( $request );
		$settings = WeeklyNotificationSettings::get();
		$builder  = new SummaryBuilder();
		$check    = '' !== $settings['source_slug'] || $settings['page_id']
			? $builder->check( $settings['source_slug'], $settings['page_id'] )
			: true;

		return rest_ensure_response(
			array(
				'enabled'                   => $settings['enabled'],
				'source_slug'               => $settings['source_slug'],
				'page_id'                   => $settings['page_id'],
				'day_of_week'               => $settings['day_of_week'],
				'time_of_day'               => $settings['time_of_day'],
				'week_scope'                => $settings['week_scope'],
				'telegram_enabled'          => $settings['providers']['telegram']['enabled'],
				'telegram_chat_ids'         => $settings['providers']['telegram']['chat_ids'],
				'telegram_token_configured' => '' !== WeeklyNotificationSettings::telegram_token(),
				'configuration_error'       => is_wp_error( $check ) ? $check->get_error_message() : null,
				'sources'                   => $this->sources(),
				'pages'                     => $this->pages( $settings['page_id'] ),
				'next_run'                  => $this->next_run(),
				'runs'                      => array_map( array( $this, 'with_local_time' ), Dispatcher::runs() ),
				'deliveries'                => ( new DeliveryLog() )->recent(),
			)
		);
	}

	/**
	 * Save settings.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$settings = WeeklyNotificationSettings::get();
		$previous = $settings;

		foreach ( array( 'enabled', 'source_slug', 'page_id', 'day_of_week', 'time_of_day', 'week_scope' ) as $field ) {
			if ( $request->has_param( $field ) ) {
				$settings[ $field ] = $request->get_param( $field );
			}
		}
		if ( $request->has_param( 'telegram_enabled' ) ) {
			$settings['providers']['telegram']['enabled'] = (bool) $request->get_param( 'telegram_enabled' );
		}

		if ( $request->has_param( 'telegram_chat_ids' ) ) {
			$chat_ids = WeeklyNotificationSettings::parse_chat_ids( $request->get_param( 'telegram_chat_ids' ) );
			$invalid  = array_filter( $chat_ids, static fn( $id ) => ! WeeklyNotificationSettings::valid_chat_id( $id ) );
			if ( $invalid ) {
				return new WP_Error(
					'invalid_chat_ids',
					sprintf(
						/* translators: %s: comma-separated list of the rejected identifiers */
						__( 'These are not Telegram chat IDs or @channel usernames: %s', 'fair-events-experimental' ),
						implode( ', ', array_map( 'sanitize_text_field', $invalid ) )
					),
					array( 'status' => 400 )
				);
			}
			if ( count( $chat_ids ) > WeeklyNotificationSettings::MAX_CHAT_IDS ) {
				return new WP_Error(
					'too_many_chat_ids',
					sprintf(
						/* translators: %d: maximum number of Telegram destinations */
						__( 'Enter at most %d Telegram chats or channels.', 'fair-events-experimental' ),
						WeeklyNotificationSettings::MAX_CHAT_IDS
					),
					array( 'status' => 400 )
				);
			}
			$settings['providers']['telegram']['chat_ids'] = $chat_ids;
		}

		$token = trim( (string) $request->get_param( 'telegram_bot_token' ) );
		if ( '' !== $token && ! WeeklyNotificationSettings::valid_token( $token ) ) {
			return new WP_Error(
				'invalid_bot_token',
				__( 'That does not look like a Telegram bot token. Copy the full token from @BotFather, for example 123456789:AAE….', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}

		$settings = WeeklyNotificationSettings::normalize( $settings );

		if ( $settings['enabled'] ) {
			$check = ( new SummaryBuilder() )->check( $settings['source_slug'], $settings['page_id'] );
			if ( is_wp_error( $check ) ) {
				return new WP_Error( $check->get_error_code(), $check->get_error_message(), array( 'status' => 400 ) );
			}
			$providers = Providers::all();
			if ( '' !== $token ) {
				// Judge Telegram by the token being saved with this request.
				$providers[ TelegramProvider::ID ] = new TelegramProvider( $token );
			}
			$has_destination = false;
			foreach ( $providers as $provider ) {
				$has_destination = $has_destination || (bool) $provider->destinations( $settings );
			}
			if ( ! $has_destination ) {
				return new WP_Error(
					'no_destination',
					__( 'Before turning on weekly notifications, turn on Telegram delivery and save a bot token and at least one chat or channel.', 'fair-events-experimental' ),
					array( 'status' => 400 )
				);
			}
		}

		if ( '' !== $token ) {
			WeeklyNotificationSettings::set_telegram_token( $token );
		}
		WeeklyNotificationSettings::save( $settings );

		$schedule_fields = array( 'enabled', 'day_of_week', 'time_of_day', 'week_scope' );
		$changed         = array_filter( $schedule_fields, static fn( $field ) => $previous[ $field ] !== $settings[ $field ] );
		if ( $changed || ( $settings['enabled'] && ! Dispatcher::next_run() ) ) {
			Dispatcher::reschedule( $settings );
		}

		return $this->get_item();
	}

	/**
	 * Remove the saved bot token.
	 *
	 * @return \WP_REST_Response
	 */
	public function clear_token() {
		WeeklyNotificationSettings::clear_telegram_token();
		return $this->get_item();
	}

	/**
	 * Preview the summary for the next scheduled week.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function get_preview() {
		$summary = $this->next_summary();
		if ( is_wp_error( $summary ) ) {
			return $summary;
		}
		$messages = ( new TelegramProvider() )->split( $summary );

		return rest_ensure_response(
			array(
				'week_start'        => $summary['week']['start'],
				'week_end'          => $summary['week']['end'],
				'text'              => $summary['text'],
				'occurrence_count'  => $summary['occurrence_count'],
				'telegram_parts'    => count( $messages ),
				'telegram_messages' => $messages,
			)
		);
	}

	/**
	 * Send the next scheduled week's summary to every saved Telegram destination.
	 *
	 * Test sends are not delivery records and do not affect scheduled sends.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function send_test() {
		if ( '' === WeeklyNotificationSettings::telegram_token() ) {
			return new WP_Error( 'missing_token', __( 'Save a Telegram bot token before sending a test message.', 'fair-events-experimental' ), array( 'status' => 400 ) );
		}

		$provider     = new TelegramProvider();
		$destinations = $provider->destinations( WeeklyNotificationSettings::get(), true );
		if ( ! $destinations ) {
			return new WP_Error( 'missing_chat_ids', __( 'Save at least one Telegram chat or channel before sending a test message.', 'fair-events-experimental' ), array( 'status' => 400 ) );
		}

		$summary = $this->next_summary();
		if ( is_wp_error( $summary ) ) {
			return $summary;
		}
		if ( 0 === $summary['occurrence_count'] ) {
			return new WP_Error( 'no_events', __( 'There are no events in the next scheduled week, so there is nothing to send.', 'fair-events-experimental' ), array( 'status' => 400 ) );
		}

		$messages = $provider->split( $summary );
		$results  = array();
		foreach ( $destinations as $destination ) {
			// Stop at the first part that is not sent, so parts never arrive out of order.
			$result = array();
			foreach ( $messages as $message ) {
				$result = $provider->send( $destination, $message );
				if ( 'sent' !== $result['state'] ) {
					break;
				}
			}
			$results[] = array(
				'destination' => $destination,
				'state'       => $result['state'],
				'message'     => $result['message'],
			);
		}

		return rest_ensure_response(
			array(
				'success' => ! array_filter( $results, static fn( $result ) => 'sent' !== $result['state'] ),
				'parts'   => count( $messages ),
				'results' => $results,
			)
		);
	}

	/**
	 * The summary for the week the next scheduled send covers.
	 *
	 * @return array|WP_Error Summary with its `week`, or a 400 error.
	 */
	private function next_summary() {
		$settings = WeeklyNotificationSettings::get();
		$due      = WeekSchedule::next_due( Dispatcher::now(), $settings['day_of_week'], $settings['time_of_day'] );
		$week     = WeekSchedule::target_week( $due, $settings['week_scope'], Dispatcher::start_of_week() );
		$summary  = ( new SummaryBuilder() )->build( $settings, $week );

		if ( is_wp_error( $summary ) ) {
			return new WP_Error( $summary->get_error_code(), $summary->get_error_message(), array( 'status' => 400 ) );
		}

		$summary['week'] = $week;
		return $summary;
	}

	/**
	 * Enabled event sources.
	 *
	 * @return array[]
	 */
	private function sources() {
		if ( ! class_exists( '\FairEvents\Database\EventSourceRepository' ) ) {
			return array();
		}

		return array_map(
			static fn( $source ) => array(
				'slug' => $source['slug'],
				'name' => $source['name'],
			),
			( new \FairEvents\Database\EventSourceRepository() )->get_all( true )
		);
	}

	/**
	 * Published, publicly visible pages.
	 *
	 * @param int $selected_id The saved page, listed even if it no longer qualifies.
	 * @return array[]
	 */
	private function pages( $selected_id ) {
		$ids = get_posts(
			array(
				'post_type'      => 'page',
				'post_status'    => 'publish',
				'has_password'   => false,
				'posts_per_page' => -1,
				'orderby'        => 'title',
				'order'          => 'ASC',
				'fields'         => 'ids',
				// Every language: the chosen page sets the message language.
				'lang'           => '',
			)
		);

		$ids = array_map( 'intval', $ids );
		if ( $selected_id && ! in_array( (int) $selected_id, $ids, true ) && get_post( $selected_id ) ) {
			$ids[] = (int) $selected_id;
		}

		return array_map(
			static fn( $id ) => array(
				'id'    => $id,
				'title' => '' !== get_the_title( $id ) ? html_entity_decode( get_the_title( $id ), ENT_QUOTES ) : __( '(no title)', 'fair-events-experimental' ),
				'url'   => (string) get_permalink( $id ),
			),
			$ids
		);
	}

	/**
	 * The next scheduled send, formatted for display.
	 *
	 * @return array|null
	 */
	private function next_run() {
		$next = Dispatcher::next_run();
		if ( ! $next ) {
			return null;
		}
		$week = WeekSchedule::week_from_start( $next['week_start'] );

		return array(
			'timestamp'  => $next['timestamp'],
			'time_local' => wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $next['timestamp'] ),
			'week_start' => $week['start'],
			'week_end'   => $week['end'],
			'week_title' => class_exists( '\FairEvents\Services\EventsWeekSummary' )
				? \FairEvents\Services\EventsWeekSummary::range_title( $week['start'], $week['end'] )
				: $week['start'] . ' – ' . $week['end'],
		);
	}

	/**
	 * Add a site-local display time to a run record.
	 *
	 * @param array $run Run record with a UTC `time`.
	 * @return array
	 */
	private function with_local_time( $run ) {
		$run['time_local'] = wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), strtotime( $run['time'] . ' UTC' ) );
		$run['week_title'] = class_exists( '\FairEvents\Services\EventsWeekSummary' )
			? \FairEvents\Services\EventsWeekSummary::range_title( $run['week_start'], $run['week_end'] )
			: $run['week_start'] . ' – ' . $run['week_end'];
		return $run;
	}
}
