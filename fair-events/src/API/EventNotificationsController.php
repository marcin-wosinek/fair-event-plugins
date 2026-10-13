<?php
/**
 * Event notifications administrator REST API.
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Database\EventSourceRepository;
use FairEvents\Notifications\BulkEmailAdapter;
use FairEvents\Notifications\BulkEmailDispatcher;
use FairEvents\Notifications\BulkEmailSettings;
use FairEvents\Notifications\DeliveryLog;
use FairEvents\Notifications\IndividualEmailDispatcher;
use FairEvents\Notifications\IndividualEmailEvents;
use FairEvents\Notifications\IndividualEmailRenderer;
use FairEvents\Notifications\IndividualEmailSettings;
use FairEvents\Notifications\Ownership;
use FairEvents\Notifications\SummaryBuilder;
use FairEvents\Notifications\TelegramConnector;
use FairEvents\Notifications\TelegramDispatcher;
use FairEvents\Notifications\TelegramProvider;
use FairEvents\Notifications\TelegramSettings;
use FairEvents\Notifications\WeekSchedule;
use FairEvents\Services\EmailService;
use FairEvents\Services\EventsWeekSummary;
use FairEvents\Services\WeeklyEventsProvider;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Settings, preview, test and status routes for weekly event notifications.
 *
 * Every channel has its own settings, preview and test routes, so saving or
 * testing one never touches another. A channel this plugin does not run on
 * this request (its former owner still sends it, or the plugin that delivers
 * it is inactive) is read-only: its saved settings stay as they are.
 *
 * The individual email is sent by this plugin alone, to one address an
 * administrator typed in. That address is only ever returned by these
 * administrator-only routes.
 *
 * The Telegram bot token is managed in Settings → Connectors. Responses report
 * only whether one is configured and where it comes from, and provider errors
 * are returned with the token removed.
 */
class EventNotificationsController extends WP_REST_Controller {

	/**
	 * Route namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Route base.
	 *
	 * @var string
	 */
	protected $rest_base = 'event-notifications';

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$schedule_args = array(
			'enabled'     => array( 'type' => 'boolean' ),
			'source_slug' => array( 'type' => 'string' ),
			'day_of_week' => array(
				'type'    => 'integer',
				'minimum' => 1,
				'maximum' => 7,
			),
			'time_of_day' => array(
				'type'              => 'string',
				'validate_callback' => array( $this, 'validate_time' ),
			),
			'week_scope'  => array(
				'type' => 'string',
				'enum' => TelegramSettings::WEEK_SCOPES,
			),
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_item' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/telegram',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => array( $this, 'update_telegram' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => $schedule_args + array(
					'page_id'  => array(
						'type'    => 'integer',
						'minimum' => 0,
					),
					'chat_ids' => array(
						'type'  => array( 'array', 'string' ),
						'items' => array( 'type' => 'string' ),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/telegram/preview',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'preview_telegram' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/telegram/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'test_telegram' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/bulk-email',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => array( $this, 'update_bulk_email' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => $schedule_args + array(
					'skip_empty' => array( 'type' => 'boolean' ),
					'subject'    => array(
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'intro'      => array(
						'type'              => 'string',
						'sanitize_callback' => 'wp_kses_post',
					),
					'outro'      => array(
						'type'              => 'string',
						'sanitize_callback' => 'wp_kses_post',
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/bulk-email/preview',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'preview_bulk_email' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/bulk-email/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'test_bulk_email' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/individual-email',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => array( $this, 'update_individual_email' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => array_diff_key( $schedule_args, array( 'source_slug' => true ) ) + array(
					// Checked in the callback, so its message reaches the page.
					'recipient'       => array( 'type' => 'string' ),
					'event_selection' => array(
						'type'              => 'string',
						'validate_callback' => array( $this, 'validate_event_selection' ),
					),
					'skip_empty'      => array( 'type' => 'boolean' ),
					'subject'         => array(
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'intro'           => array(
						'type'              => 'string',
						'sanitize_callback' => 'wp_kses_post',
					),
					'outro'           => array(
						'type'              => 'string',
						'sanitize_callback' => 'wp_kses_post',
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/individual-email/preview',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'preview_individual_email' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/individual-email/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'test_individual_email' ),
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
			__( 'You do not have permission to manage event notifications.', 'fair-events' ),
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
		return TelegramSettings::valid_time( $value )
			? true
			: new WP_Error( 'invalid_time', __( 'Enter the send time as HH:MM, for example 09:00.', 'fair-events' ), array( 'status' => 400 ) );
	}

	/**
	 * Validate the individual email's event selection.
	 *
	 * @param mixed $value Selection.
	 * @return true|WP_Error
	 */
	public function validate_event_selection( $value ) {
		return IndividualEmailSettings::valid_selection( $value )
			? true
			: new WP_Error( 'invalid_event_selection', __( 'Choose which events to include.', 'fair-events' ), array( 'status' => 400 ) );
	}

	/**
	 * Read every channel's settings and delivery status.
	 *
	 * @param WP_REST_Request|null $request Request, unused.
	 * @return \WP_REST_Response
	 */
	public function get_item( $request = null ) {
		unset( $request );
		$telegram = TelegramSettings::get();

		return rest_ensure_response(
			array(
				'sources'  => $this->sources(),
				'pages'    => $this->pages( $telegram['page_id'] ),
				'channels' => array(
					'telegram'         => $this->telegram_channel( $telegram ),
					'bulk_email'       => $this->bulk_email_channel(),
					'individual_email' => $this->individual_email_channel(),
				),
			)
		);
	}

	/**
	 * Save the Telegram settings.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_telegram( $request ) {
		$unavailable = $this->telegram_unavailable();
		if ( $unavailable ) {
			return $unavailable;
		}

		// The token lives in Connectors; never treat it as a setting here.
		if ( $request->has_param( 'telegram_bot_token' ) || $request->has_param( 'bot_token' ) ) {
			return new WP_Error(
				'token_managed_in_connectors',
				__( 'The Telegram bot token is managed in Settings → Connectors. Nothing was saved.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$settings = TelegramSettings::get();
		$previous = $settings;

		foreach ( array( 'source_slug', 'page_id', 'day_of_week', 'time_of_day', 'week_scope' ) as $field ) {
			if ( $request->has_param( $field ) ) {
				$settings[ $field ] = $request->get_param( $field );
			}
		}
		// One switch for the administrator; both stored flags follow it.
		if ( $request->has_param( 'enabled' ) ) {
			$settings['enabled']                          = (bool) $request->get_param( 'enabled' );
			$settings['providers']['telegram']['enabled'] = $settings['enabled'];
		}

		if ( $request->has_param( 'chat_ids' ) ) {
			$chat_ids = TelegramSettings::parse_chat_ids( $request->get_param( 'chat_ids' ) );
			$invalid  = array_filter(
				$chat_ids,
				static function ( $id ) {
					return ! TelegramSettings::valid_chat_id( $id );
				}
			);
			if ( $invalid ) {
				return new WP_Error(
					'invalid_chat_ids',
					sprintf(
						/* translators: %s: comma-separated list of the rejected identifiers */
						__( 'These are not Telegram chat IDs or @channel usernames: %s', 'fair-events' ),
						implode( ', ', array_map( 'sanitize_text_field', $invalid ) )
					),
					array( 'status' => 400 )
				);
			}
			if ( count( $chat_ids ) > TelegramSettings::MAX_CHAT_IDS ) {
				return new WP_Error(
					'too_many_chat_ids',
					sprintf(
						/* translators: %d: maximum number of Telegram destinations */
						__( 'Enter at most %d Telegram chats or channels.', 'fair-events' ),
						TelegramSettings::MAX_CHAT_IDS
					),
					array( 'status' => 400 )
				);
			}
			$settings['providers']['telegram']['chat_ids'] = $chat_ids;
		}

		$settings = TelegramSettings::normalize( $settings );

		if ( self::telegram_on( $settings ) ) {
			$check = ( new SummaryBuilder() )->check( $settings['source_slug'], $settings['page_id'] );
			if ( is_wp_error( $check ) ) {
				return new WP_Error( $check->get_error_code(), $check->get_error_message(), array( 'status' => 400 ) );
			}
			$provider = new TelegramProvider();
			if ( ! $provider->destinations( $settings ) ) {
				$problem = $provider->configuration_error( $settings );
				return new WP_Error(
					'no_destination',
					'' !== $problem
						? $problem
						: __( 'Before turning on Telegram summaries, add a bot token in Settings → Connectors and save at least one chat or channel.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}
		}

		TelegramSettings::save( $settings );

		$schedule_fields = array( 'enabled', 'day_of_week', 'time_of_day', 'week_scope' );
		$changed         = array_filter(
			$schedule_fields,
			static function ( $field ) use ( $previous, $settings ) {
				return $previous[ $field ] !== $settings[ $field ];
			}
		);
		if ( $changed || ( $settings['enabled'] && ! TelegramDispatcher::next_run() ) ) {
			TelegramDispatcher::reschedule( $settings );
		}

		return $this->get_item();
	}

	/**
	 * Preview the Telegram summary for the next scheduled week.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function preview_telegram() {
		$summary = $this->next_summary();
		if ( is_wp_error( $summary ) ) {
			return $summary;
		}
		$messages = ( new TelegramProvider() )->split( $summary );

		return rest_ensure_response(
			array(
				'week_start'       => $summary['week']['start'],
				'week_end'         => $summary['week']['end'],
				'week_title'       => EventsWeekSummary::range_title( $summary['week']['start'], $summary['week']['end'] ),
				'occurrence_count' => $summary['occurrence_count'],
				'messages'         => $messages,
			)
		);
	}

	/**
	 * Send the next scheduled week's summary to every saved Telegram chat,
	 * with the credential currently in effect.
	 *
	 * Test sends are not delivery records and do not affect scheduled sends.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function test_telegram() {
		$unavailable = $this->telegram_unavailable();
		if ( $unavailable ) {
			return $unavailable;
		}

		// Refused before anything is built or sent, so no request reaches Telegram.
		$problem = TelegramConnector::problem();
		if ( $problem ) {
			return new WP_Error( $problem['code'], $problem['message'], array( 'status' => 400 ) );
		}

		$provider     = new TelegramProvider();
		$destinations = $provider->destinations( TelegramSettings::get(), true );
		if ( ! $destinations ) {
			return new WP_Error( 'missing_chat_ids', __( 'Save at least one Telegram chat or channel before sending a test message.', 'fair-events' ), array( 'status' => 400 ) );
		}

		$summary = $this->next_summary();
		if ( is_wp_error( $summary ) ) {
			return $summary;
		}
		if ( 0 === $summary['occurrence_count'] ) {
			return new WP_Error( 'no_events', __( 'There are no events in the next scheduled week, so there is nothing to send.', 'fair-events' ), array( 'status' => 400 ) );
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
				'success' => ! array_filter(
					$results,
					static function ( $result ) {
						return 'sent' !== $result['state'];
					}
				),
				'parts'   => count( $messages ),
				'results' => $results,
			)
		);
	}

	/**
	 * Save the weekly email settings.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_bulk_email( $request ) {
		$unavailable = $this->bulk_email_unavailable();
		if ( $unavailable ) {
			return $unavailable;
		}

		$settings = BulkEmailSettings::stored();
		$previous = $settings;
		foreach ( array_keys( BulkEmailSettings::defaults() ) as $field ) {
			if ( $request->has_param( $field ) ) {
				$settings[ $field ] = $request->get_param( $field );
			}
		}
		$settings = BulkEmailSettings::sanitize( $settings );

		if ( $settings['enabled'] ) {
			$source = '' !== $settings['source_slug'] ? ( new EventSourceRepository() )->get_by_slug( $settings['source_slug'] ) : null;
			if ( ! $source || empty( $source['enabled'] ) ) {
				return new WP_Error(
					'invalid_source',
					'' === $settings['source_slug']
						? __( 'Choose an event source before turning on the weekly email.', 'fair-events' )
						: __( 'The selected event source does not exist or is disabled.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}
		}

		BulkEmailSettings::save( $settings );

		$schedule_fields = array( 'enabled', 'day_of_week', 'time_of_day' );
		$changed         = array_filter(
			$schedule_fields,
			static function ( $field ) use ( $previous, $settings ) {
				return $previous[ $field ] !== $settings[ $field ];
			}
		);
		if ( $changed || ( $settings['enabled'] && ! BulkEmailDispatcher::next_run() ) ) {
			BulkEmailDispatcher::reschedule( $settings );
		}

		return $this->get_item();
	}

	/**
	 * Preview the weekly email the next send would deliver.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function preview_bulk_email() {
		$email = $this->next_email();
		if ( is_wp_error( $email ) ) {
			return $email;
		}

		return rest_ensure_response( $email );
	}

	/**
	 * Send the weekly email to the current administrator only.
	 *
	 * A test never counts as the week's send.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function test_bulk_email() {
		$email = $this->next_email();
		if ( is_wp_error( $email ) ) {
			return $email;
		}

		$recipient = wp_get_current_user()->user_email;
		if ( ! ( new BulkEmailAdapter() )->send_test( $recipient, $email['subject'], $email['html'] ) ) {
			return new WP_Error(
				'send_failed',
				sprintf(
					/* translators: %s: email address */
					__( 'The test email to %s could not be sent.', 'fair-events' ),
					$recipient
				),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response( array( 'sent_to' => $recipient ) );
	}

	/**
	 * Save the individual email settings.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_individual_email( $request ) {
		// Refused as a whole: a list or an address with extra headers is never
		// trimmed down to something that could be saved.
		if ( $request->has_param( 'recipient' ) && null === IndividualEmailSettings::parse_recipient( $request->get_param( 'recipient' ) ) ) {
			return new WP_Error(
				'invalid_recipient',
				__( 'Enter exactly one email address, for example name@example.com. Nothing was saved.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$settings = IndividualEmailSettings::stored();
		$previous = $settings;
		foreach ( array_keys( IndividualEmailSettings::defaults() ) as $field ) {
			if ( $request->has_param( $field ) ) {
				$settings[ $field ] = $request->get_param( $field );
			}
		}
		$settings = IndividualEmailSettings::sanitize( $settings );

		if ( $settings['enabled'] ) {
			if ( '' === $settings['recipient'] ) {
				return new WP_Error(
					'missing_recipient',
					__( 'Enter the email address that receives the weekly email before turning it on.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}
			$check = ( new IndividualEmailEvents() )->check( $settings['event_selection'] );
			if ( is_wp_error( $check ) ) {
				return new WP_Error( $check->get_error_code(), $check->get_error_message(), array( 'status' => 400 ) );
			}
		}

		IndividualEmailSettings::save( $settings );

		$schedule_fields = array( 'enabled', 'day_of_week', 'time_of_day' );
		$changed         = array_filter(
			$schedule_fields,
			static function ( $field ) use ( $previous, $settings ) {
				return $previous[ $field ] !== $settings[ $field ];
			}
		);
		if ( $changed || ( $settings['enabled'] && ! IndividualEmailDispatcher::next_run() ) ) {
			IndividualEmailDispatcher::reschedule( $settings );
		}

		return $this->get_item();
	}

	/**
	 * Preview the individual email the next send would deliver, and to whom.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function preview_individual_email() {
		$email = $this->next_individual_email();
		if ( is_wp_error( $email ) ) {
			return $email;
		}

		return rest_ensure_response( $email );
	}

	/**
	 * Send the individual email to the saved address only.
	 *
	 * Works while the schedule is off. A test never counts as the week's
	 * send and does not move the next scheduled one.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function test_individual_email() {
		$email = $this->next_individual_email();
		if ( is_wp_error( $email ) ) {
			return $email;
		}

		$recipient = $email['recipient'];
		if ( '' === $recipient ) {
			return new WP_Error( 'missing_recipient', __( 'Save the email address that receives the weekly email before sending a test.', 'fair-events' ), array( 'status' => 400 ) );
		}

		try {
			$sent = ( new EmailService() )->send_notification( $recipient, $email['subject'], $email['html'] );
		} catch ( \Throwable $e ) {
			$sent = false;
		}
		if ( ! $sent ) {
			return new WP_Error(
				'send_failed',
				sprintf(
					/* translators: %s: email address */
					__( 'The test email to %s could not be sent.', 'fair-events' ),
					$recipient
				),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'sent_to' => $recipient,
				'empty'   => $email['empty'],
			)
		);
	}

	/**
	 * Whether Telegram summaries are turned on in a settings array.
	 *
	 * @param array $settings Telegram settings.
	 * @return bool
	 */
	private static function telegram_on( array $settings ) {
		return $settings['enabled'] && $settings['providers']['telegram']['enabled'];
	}

	/**
	 * Telegram channel payload.
	 *
	 * @param array $settings Telegram settings.
	 * @return array
	 */
	private function telegram_channel( array $settings ) {
		$owned = Ownership::owns( Ownership::TELEGRAM );
		$token = TelegramConnector::status();
		$check = '' !== $settings['source_slug'] || $settings['page_id']
			? ( new SummaryBuilder() )->check( $settings['source_slug'], $settings['page_id'] )
			: true;
		$next  = $owned ? TelegramDispatcher::next_run() : null;

		return array(
			'state'               => $owned ? 'active' : 'update_required',
			'state_message'       => $owned ? '' : __( 'Telegram summaries are still sent by an older Fair Events Experimental. Update Fair Events Experimental to manage them here; until then they keep running from its settings.', 'fair-events' ),
			'enabled'             => self::telegram_on( $settings ),
			'source_slug'         => $settings['source_slug'],
			'page_id'             => $settings['page_id'],
			'day_of_week'         => $settings['day_of_week'],
			'time_of_day'         => $settings['time_of_day'],
			'week_scope'          => $settings['week_scope'],
			'chat_ids'            => $settings['providers']['telegram']['chat_ids'],
			'token_configured'    => $token['configured'],
			'token_valid'         => $token['valid'],
			'token_source'        => $token['source'],
			'token_override_name' => TelegramConnector::CREDENTIAL_NAME,
			'connectors_url'      => TelegramConnector::admin_url(),
			'configuration_error' => is_wp_error( $check ) ? $check->get_error_message() : null,
			'next_run'            => $next ? $this->telegram_next_run( $next ) : null,
			'runs'                => array_map( array( $this, 'with_local_time' ), TelegramDispatcher::runs() ),
			'deliveries'          => $owned ? ( new DeliveryLog() )->recent( TelegramProvider::ID ) : array(),
		);
	}

	/**
	 * Weekly email channel payload.
	 *
	 * @return array
	 */
	private function bulk_email_channel() {
		$availability = ( new BulkEmailAdapter() )->availability();
		$owned        = Ownership::owns( Ownership::BULK_EMAIL );
		$state        = $owned || BulkEmailAdapter::ACTIVE !== $availability ? $availability : BulkEmailAdapter::UPDATE_REQUIRED;
		$messages     = array(
			BulkEmailAdapter::ACTIVE          => '',
			BulkEmailAdapter::INACTIVE        => __( 'The weekly email is paused because Fair Audience is not active. Fair Audience decides who receives it and sends it. Your settings are kept and sending resumes at the next scheduled time once Fair Audience is active again.', 'fair-events' ),
			BulkEmailAdapter::UPDATE_REQUIRED => __( 'The weekly email is still sent by an older Fair Audience. Update Fair Audience to manage it here; until then it keeps running from the Weekly Digest page.', 'fair-events' ),
		);
		$next         = BulkEmailAdapter::ACTIVE === $state ? BulkEmailDispatcher::next_run() : null;

		return array_merge(
			BulkEmailSettings::get(),
			array(
				'state'          => $state,
				'state_message'  => $messages[ $state ],
				'test_recipient' => wp_get_current_user()->user_email,
				'last_sent_week' => (string) get_option( BulkEmailDispatcher::LAST_SENT_OPTION, '' ),
				'next_run'       => $next
					? array(
						'timestamp'  => $next['timestamp'],
						'time_local' => $this->local_time( $next['timestamp'] ),
						'send_week'  => $next['send_week'],
					)
					: null,
				'runs'           => array_map( array( $this, 'with_local_time' ), BulkEmailDispatcher::runs() ),
			)
		);
	}

	/**
	 * Individual email channel payload.
	 *
	 * @return array
	 */
	private function individual_email_channel() {
		$settings = IndividualEmailSettings::get();
		$check    = ( new IndividualEmailEvents() )->check( $settings['event_selection'] );
		$next     = IndividualEmailDispatcher::next_run();

		return array_merge(
			$settings,
			array(
				'state'               => 'active',
				'state_message'       => '',
				'configuration_error' => is_wp_error( $check ) ? $check->get_error_message() : null,
				'last_sent_week'      => (string) get_option( IndividualEmailDispatcher::LAST_SENT_OPTION, '' ),
				'next_run'            => $next
					? array(
						'timestamp'  => $next['timestamp'],
						'time_local' => $this->local_time( $next['timestamp'] ),
						'send_week'  => $next['send_week'],
					)
					: null,
				'runs'                => array_map( array( $this, 'with_local_time' ), IndividualEmailDispatcher::runs() ),
			)
		);
	}

	/**
	 * Why Telegram cannot be changed or tested on this request, if it cannot.
	 *
	 * @return WP_Error|null
	 */
	private function telegram_unavailable() {
		if ( Ownership::owns( Ownership::TELEGRAM ) ) {
			return null;
		}

		return new WP_Error(
			'channel_update_required',
			__( 'Update Fair Events Experimental to manage Telegram summaries here. Nothing was changed.', 'fair-events' ),
			array( 'status' => 409 )
		);
	}

	/**
	 * Why the weekly email cannot be changed or sent on this request, if it cannot.
	 *
	 * @return WP_Error|null
	 */
	private function bulk_email_unavailable() {
		$availability = ( new BulkEmailAdapter() )->availability();
		if ( BulkEmailAdapter::INACTIVE === $availability ) {
			return new WP_Error(
				'fair_audience_inactive',
				__( 'Activate Fair Audience to manage and send the weekly email. Your saved settings were not changed.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}
		if ( BulkEmailAdapter::ACTIVE !== $availability || ! Ownership::owns( Ownership::BULK_EMAIL ) ) {
			return new WP_Error(
				'channel_update_required',
				__( 'Update Fair Audience to manage the weekly email here. Nothing was changed.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		return null;
	}

	/**
	 * The Telegram summary for the week the next scheduled send covers.
	 *
	 * @return array|WP_Error Summary with its `week`, or a 400 error.
	 */
	private function next_summary() {
		$settings = TelegramSettings::get();
		$due      = WeekSchedule::next_due( TelegramDispatcher::now(), $settings['day_of_week'], $settings['time_of_day'] );
		$week     = WeekSchedule::target_week( $due, $settings['week_scope'], TelegramDispatcher::start_of_week() );
		$summary  = ( new SummaryBuilder() )->build( $settings, $week );

		if ( is_wp_error( $summary ) ) {
			return new WP_Error( $summary->get_error_code(), $summary->get_error_message(), array( 'status' => 400 ) );
		}

		$summary['week'] = $week;
		return $summary;
	}

	/**
	 * The weekly email as the next scheduled send would deliver it.
	 *
	 * @return array|WP_Error Subject, body and week, or an error.
	 */
	private function next_email() {
		$unavailable = $this->bulk_email_unavailable();
		if ( $unavailable ) {
			return $unavailable;
		}

		$settings = BulkEmailSettings::get();
		if ( '' === $settings['source_slug'] ) {
			return new WP_Error( 'missing_source', __( 'Choose an event source and save before previewing the weekly email.', 'fair-events' ), array( 'status' => 400 ) );
		}

		$due  = BulkEmailDispatcher::next_due( $settings, BulkEmailDispatcher::now(), (string) get_option( BulkEmailDispatcher::LAST_SENT_OPTION, '' ) );
		$week = ( new WeeklyEventsProvider() )->get_week( $settings['source_slug'], ...BulkEmailDispatcher::event_week( $settings['week_scope'], $due ) );
		if ( is_wp_error( $week ) ) {
			return new WP_Error( $week->get_error_code(), $week->get_error_message(), array( 'status' => 400 ) );
		}

		$email = ( new BulkEmailAdapter() )->compose( $week, $settings );

		return array(
			'subject'    => (string) $email['subject'],
			'html'       => (string) $email['html'],
			'empty'      => ! empty( $email['empty'] ),
			'week_start' => $week['week']['start'],
			'week_end'   => $week['week']['end'],
			'week_title' => EventsWeekSummary::range_title( $week['week']['start'], $week['week']['end'] ),
		);
	}

	/**
	 * The individual email as the next scheduled send would deliver it.
	 *
	 * Built from the saved settings, also while the schedule is off.
	 *
	 * @return array|WP_Error Recipient, subject, body and week, or an error.
	 */
	private function next_individual_email() {
		$settings = IndividualEmailSettings::get();
		$due      = IndividualEmailDispatcher::next_due( $settings, BulkEmailDispatcher::now(), (string) get_option( IndividualEmailDispatcher::LAST_SENT_OPTION, '' ) );
		$week     = IndividualEmailDispatcher::event_week( $settings['week_scope'], $due );

		$occurrences = ( new IndividualEmailEvents() )->for_week( $settings['event_selection'], $week );
		if ( is_wp_error( $occurrences ) ) {
			return new WP_Error( $occurrences->get_error_code(), $occurrences->get_error_message(), array( 'status' => 400 ) );
		}

		$email = IndividualEmailRenderer::compose( $settings, $week, $occurrences );

		return array(
			'recipient'  => $settings['recipient'],
			'subject'    => $email['subject'],
			'html'       => wp_kses_post( $email['html'] ),
			'empty'      => $email['empty'],
			'skip_empty' => $settings['skip_empty'],
			'week_start' => $week['start'],
			'week_end'   => $week['end'],
			'week_title' => EventsWeekSummary::range_title( $week['start'], $week['end'] ),
		);
	}

	/**
	 * Enabled event sources.
	 *
	 * @return array[]
	 */
	private function sources() {
		return array_map(
			static function ( $source ) {
				return array(
					'slug' => $source['slug'],
					'name' => $source['name'],
				);
			},
			( new EventSourceRepository() )->get_all( true )
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
			static function ( $id ) {
				return array(
					'id'    => $id,
					'title' => '' !== get_the_title( $id ) ? html_entity_decode( get_the_title( $id ), ENT_QUOTES ) : __( '(no title)', 'fair-events' ),
				);
			},
			$ids
		);
	}

	/**
	 * The next scheduled Telegram send, formatted for display.
	 *
	 * @param array $next Scheduled send.
	 * @return array
	 */
	private function telegram_next_run( array $next ) {
		$week = WeekSchedule::week_from_start( $next['week_start'] );

		return array(
			'timestamp'  => $next['timestamp'],
			'time_local' => $this->local_time( $next['timestamp'] ),
			'week_start' => $week['start'],
			'week_end'   => $week['end'],
			'week_title' => EventsWeekSummary::range_title( $week['start'], $week['end'] ),
		);
	}

	/**
	 * Add a site-local display time and the covered week's title to a run record.
	 *
	 * @param array $run Run record with a UTC `time`.
	 * @return array
	 */
	private function with_local_time( $run ) {
		$run['time_local'] = $this->local_time( strtotime( $run['time'] . ' UTC' ) );
		$run['week_title'] = ! empty( $run['week_start'] ) && ! empty( $run['week_end'] )
			? EventsWeekSummary::range_title( $run['week_start'], $run['week_end'] )
			: '';
		return $run;
	}

	/**
	 * A moment in the site's date and time format and timezone.
	 *
	 * @param int $timestamp Unix timestamp.
	 * @return string
	 */
	private function local_time( $timestamp ) {
		return wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $timestamp );
	}
}
