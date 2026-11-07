# Orbital: A Smart Satellite Health and Collision Avoidance Simulator

## Team Information (DSCPP-III-2026-T004)

| Role | Name | Student ID |
| :--- | :--- | :--- |
| **Team Lead** | Chhavit | 2510011425 |
| **Member 2** | Harsh Jain | 2510370400 |
| **Member 3** | Satyam Kumar | 2510380092 |
| **Member 4** | Sudhanshu Ojha | 2510011648 |

## Project Description

### Motivation
Space is getting too crowded. With more satellites being launched every year, the chance of them crashing into floating space junk is very high. Right now, if a satellite is about to crash or has a computer glitch, human operators on Earth have to spot the problem, figure out a solution, and send commands up to space to fix it. This delay can be dangerous. If a satellite's software freezes or a thruster breaks, waiting for Earth to fix it might result in a crash. We need to build satellites that can fix their own software bugs and dodge space junk automatically, without waiting for humans to tell them what to do.

### State of the Art / Current Solution
Today, space agencies use large radar systems on Earth to track space junk. When they see a crash might happen, humans calculate a new path and send a message to the satellite telling it to move. Health checks are also done by humans reading data sent back to Earth. If a software update is needed, it is manually scheduled. This takes a lot of time and effort, and this human-in-the-loop method will not work well when there are tens of thousands of satellites in the sky.

## Project Goals and Milestones
Our main goal is to build a C++ simulation of autonomous satellites that monitor their own health, detect nearby collision threats, prioritize those threats using data structures, and execute evasive maneuvers based on both the threat proximity and available fuel. As part of our Phase III upgrade, the simulation data is now visualized through a dedicated HTML/CSS web frontend.

**Milestones:**
1. **Core Foundation:** Create the basic Object-Oriented setup for satellites tracking position, fuel, and battery. *(Completed)*
2. **Specialized Types:** Add different types of satellites using Inheritance. *(Completed)*
3. **Space Grid (DSA):** Build the 3D grid system using an AVL Tree so satellites only look for debris in their current area. *(Completed)*
4. **Threat Priority (DSA):** Add the threat radar using a Min-Heap so satellites always spot and dodge the closest danger first. *(Completed)*
5. **Chaos Engine:** Throw random problems—like solar flares or broken thrusters—at the satellites to test their self-healing code. *(Completed)*
6. **Logging & Telemetry:** Save every action to a `blackbox.txt` file and export coordinates to `telemetry.csv`. *(Completed)*
7. **Web Visualization:** Build an HTML/CSS/JS frontend to parse the telemetry data and visually animate the orbital simulation. *(Completed - Phase III)*

## Project Approach
This project is a combined Project-Based Learning (PBL) assignment built initially in C++, combining **Object-Oriented Programming (OOP)** and **Data Structures and Algorithms (DSA)**, and extended with a web-based visualization frontend.

### OOP Concepts (C++ Backend):
- **Classes and Objects:** Every satellite and piece of debris is built as a self-contained object.
- **Inheritance:** A main base class called `Satellite` handles basic flying, fuel, and gravity calculations. Specific types like `CommunicationSatellite` and `ImagingSatellite` inherit from it.
- **Polymorphism:** Each specific satellite has its own unique way to run health checks (using virtual functions), allowing them to self-heal differently.
- **Encapsulation:** Important data like fuel levels and software health are locked inside the classes so outside code cannot accidentally change them.

### DSA Concepts (C++ Backend):
- **AVL Trees:** Used to chop space into a 3D grid. A satellite only searches its local tree "sector" to find nearby junk, keeping the program running fast.
- **Min-Heaps (Priority Queues):** Once a satellite spots nearby junk, it puts the distances into a Min-Heap. This guarantees that the absolute closest, most dangerous piece of junk is automatically pushed to the top of the list to be dodged first.
- **Circular Queues:** Used to track a rolling history of the satellite's battery life over time, dropping the oldest data as new data comes in.
- **Linear Search:** Implemented at the end of the simulation to allow users to search for final satellite coordinates by exact name.

## System Architecture

1. **Chaos Engine (Input):** A background system that randomly generates space junk and throws system errors (like battery drains or sensor faults) at the satellites.
2. **Grid Tracker (AVL Tree):** Sorts all the moving space junk into specific 3D space sectors for quick searching.
3. **Threat Radar (Min-Heap):** Looks at the junk in the satellite's sector and puts the closest, most dangerous piece at the very top of the priority list.
4. **Flight Computer (OOP Polymorphism):** Checks the Threat Radar. If junk crosses the safe distance and sufficient fuel is available, it fires the thrusters to move the satellite.
5. **Health Monitor (Circular Queue):** Constantly tracks battery history and software. It auto-fixes software bugs or initiates a physical repair dispatch ("Safe Mode") if hardware breaks.
6. **Data Output (Logs & CSV):** Saves every movement, error, and dodge into `blackbox.txt` and records X, Y, Z coordinates per tick into `telemetry.csv`.
7. **Frontend Web App (Phase III):** An HTML/CSS/JS application that parses the `telemetry.csv` and Celestrak imports to visually render the Earth, orbital paths, and playback timeline in 3D.

## Project Outcome / Deliverables
- **Modular C++ Backend:** A robust command-line application divided into specialized `.h` header modules to prevent Git merge conflicts.
- **Live CLI Dashboard:** The terminal provides live updates of all satellites, displaying health status, fuel, distance to Earth, nearest friendly satellite, and alert messages.
- **Log Files:** The backend generates a timestamped `blackbox.txt` history log and a `telemetry.csv` coordinate map.
- **Visual Web Frontend (Phase III):** An interactive website that provides 3D projections, camera views, a playback timeline, event feeds, and a raw data table for the simulation.

## Assumptions (Backend)
- Satellites can instantly fire their thrusters to change direction.
- A simplified simulated gravitational pull constantly bends velocity vectors to create circular orbits.
- Satellites have perfect sensors and know exactly where the space junk is in their immediate AVL Tree sector.
- Physical repairs (Safe Mode) take a fixed amount of time (ticks) to complete.

## Codebase Information & Recent Updates
*   **Repository Branch:** `main`
*   **Phase III Frontend Updates:** Located in `Programs/Frontend`, featuring full 3D projection, timeline playback, and CelesTrak data import.
*   **Phase II Backend Updates:** Modularized C++ codebase, robust `cin` input validation, circular gravity implementation, active fuel tracking, and linear search capabilities.

## Licence
© 2026 Chhavit, Harsh Jain, Satyam Kumar and Sudhanshu Ojha. All Rights Reserved.
Proprietary project: no copying, modification or distribution without the authors' written permission. See [LICENSE](LICENSE) for the full terms.

## References
- C++ and DSA guides for AVL trees, min-heaps and OOP (inheritance, polymorphism).
- Kessler & Cour-Palais, "Collision frequency of artificial satellites: the creation of a debris belt", *J. Geophys. Res.*, 1978.
- ESA Space Debris Office, *Annual Space Environment Report*.
- H. D. Curtis, *Orbital Mechanics for Engineering Students*.
- D. A. Vallado, *Fundamentals of Astrodynamics and Applications*, 2013.
- Hoots & Roehrich, *Spacetrack Report No. 3* (SGP4), 1980.
- CelesTrak orbital data: [celestrak.org](https://celestrak.org/NORAD/elements/)
- Adelson-Velsky & Landis, original AVL tree paper, 1962.
- Cormen et al., *Introduction to Algorithms*, MIT Press.
- B. Stroustrup, *The C++ Programming Language*.
- MDN Web Docs, [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API).
