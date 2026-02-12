<?php
/**
 * Event Participants Meta Box
 *
 * @package FairAudience
 */

namespace FairAudience\Admin;

use FairAudience\Database\EventParticipantRepository;

defined( 'WPINC' ) || die;

/**
 * Meta box for displaying event participant counts and link on the event edit screen.
 */
class EventParticipantsMetaBox {

	/**
	 * Initialize hooks for participants meta box.
	 */
	public static function init() {
		add_action( 'add_meta_boxes', array( __CLASS__, 'add_meta_box' ) );
	}

	/**
	 * Add participants meta box to event edit screen.
	 */
	public static function add_meta_box() {
		if ( ! defined( 'FAIR_EVENTS_PLUGIN_DIR' ) ) {
			return;
		}

		$enabled_post_types = \FairEvents\Settings\Settings::get_enabled_post_types();

		foreach ( $enabled_post_types as $post_type ) {
			add_meta_box(
				'fair_audience_participants',
				__( 'Event Participants', 'fair-audience' ),
				array( __CLASS__, 'render_meta_box' ),
				$post_type,
				'side',
				'default'
			);
		}
	}

	/**
	 * Render participants meta box content.
	 *
	 * @param \WP_Post $post Post object.
	 */
	public static function render_meta_box( $post ) {
		$repository = new EventParticipantRepository();
		$counts     = $repository->get_label_counts_for_event( $post->ID );

		$total = $counts['signed_up'] + $counts['collaborator'] + $counts['interested'];

		$parts = array();
		if ( $counts['signed_up'] > 0 ) {
			$parts[] = sprintf(
				/* translators: %d: number of participants */
				_n( '%d signed up', '%d signed up', $counts['signed_up'], 'fair-audience' ),
				$counts['signed_up']
			);
		}
		if ( $counts['collaborator'] > 0 ) {
			$parts[] = sprintf(
				/* translators: %d: number of collaborators */
				_n( '%d collaborator', '%d collaborators', $counts['collaborator'], 'fair-audience' ),
				$counts['collaborator']
			);
		}
		if ( $counts['interested'] > 0 ) {
			$parts[] = sprintf(
				/* translators: %d: number of interested participants */
				_n( '%d interested', '%d interested', $counts['interested'], 'fair-audience' ),
				$counts['interested']
			);
		}

		if ( $total > 0 ) {
			?>
			<p><?php echo esc_html( implode( ', ', $parts ) ); ?></p>
			<?php
		} else {
			?>
			<p><?php esc_html_e( 'No participants yet.', 'fair-audience' ); ?></p>
			<?php
		}

		$participants_url = admin_url( 'admin.php?page=fair-audience-event-participants&event_id=' . $post->ID );
		?>
		<p>
			<a href="<?php echo esc_url( $participants_url ); ?>" class="button">
				<?php esc_html_e( 'View Participants', 'fair-audience' ); ?>
			</a>
		</p>
		<?php
	}
}
