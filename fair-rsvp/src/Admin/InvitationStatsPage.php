<?php
/**
 * Invitation Stats page for Fair RSVP
 *
 * @package FairRsvp
 */

namespace FairRsvp\Admin;

defined( 'WPINC' ) || die;

/**
 * Invitation Stats Page class for viewing invitation statistics
 */
class InvitationStatsPage {

	/**
	 * Render the invitation stats page
	 *
	 * @return void
	 */
	public function render() {
		?>
		<div id="fair-rsvp-stats-root"></div>
		<?php
	}
}
