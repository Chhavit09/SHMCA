#  Orbital: A Smart Satellite Health and Collision Avoidance Simulator

##  Team Information (DSCPP-III-2026-T004)

| Role | Name | Student ID |
| :--- | :--- | :--- |
| **Team Lead** | Chhavit | 2510011425 |
| **Member 2** | Harsh Jain | 2510370400 |
| **Member 3** | Satyam Kumar | 2510380092 |
| **Member 4** | Sudhanshu Ojha | 2510011648 |

##  Project Description

### Motivation
Space is getting too crowded. With more satellites being launched every year, the chance of them crashing into floating space junk is very high. Right now, if a satellite is about to crash or has a computer glitch, human operators on Earth have to spot the problem, figure out a solution, and send commands up to space to fix it. This delay can be dangerous. If a satellite's software freezes or a thruster breaks, waiting for Earth to fix it might result in a crash. We need to build satellites that can fix their own software bugs and dodge space junk automatically, without waiting for humans to tell them what to do.

### State of the Art / Current Solution
Today, space agencies use large radar systems on Earth to track space junk. When they see a crash might happen, humans calculate a new path and send a message to the satellite telling it to move. Health checks are also done by humans reading data sent back to Earth. If a software update is needed, it is manually scheduled. This takes a lot of time and effort, and this human-in-the-loop method will not work well when there are tens of thousands of satellites in the sky.

##  Project Goals and Milestones
Our main goal is to build a C++ computer program that simulates satellites flying in space, tracking their own health, and dodging debris using smart programming techniques.

**Milestones:**
1. **Core Foundation:** Create the basic Object-Oriented setup for satellites tracking position, fuel, and battery.
2. **Specialized Types:** Add different types of satellites using Inheritance.
3. **Space Grid (DSA):** Build the 3D grid system using an AVL Tree so satellites only look for debris in their current area.
4. **Threat Priority (DSA):** Add the threat radar using a Min-Heap so satellites always spot and dodge the closest danger first.
5. **Chaos Engine:** Throw random problems—like solar flares or broken thrusters—at the satellites to test their self-healing code.
6. **Logging:** Save every action to a blackbox text file.

##  Project Approach
This project is a combined Project-Based Learning (PBL) assignment built in C++, combining **Object-Oriented Programming (OOP)** and **Data Structures and Algorithms (DSA)**.

### OOP Concepts:
* **Classes and Objects:** Every satellite and piece of debris is built as a self-contained object.
* **Inheritance:** A main base class called `Satellite` handles basic flying and fuel. Specific types like `CommunicationSatellite` and `ImagingSatellite` inherit from it.
* **Polymorphism:** Each specific satellite has its own unique way to run health checks (using virtual functions), allowing them to self-heal differently.
* **Encapsulation:** Important data like fuel levels and software health are locked inside the classes so outside code cannot accidentally change them.

### DSA Concepts:
* **AVL Trees:** Used to chop space into a 3D grid. A satellite only searches its local tree "sector" to find nearby junk, keeping the program running fast.
* **Min-Heaps (Priority Queues):** Once a satellite spots nearby junk, it puts the distances into a Min-Heap. This guarantees that the absolute closest, most dangerous piece of junk is automatically pushed to the top of the list to be dodged first.
* **Circular Queues:** Used to track a rolling history of the satellite's battery life over time, dropping the oldest data as new data comes in.

##  System Architecture

1. **Chaos Engine (Input):** A background system that randomly generates space junk and throws system errors (like battery drains) at the satellites.
2. **Grid Tracker (AVL Tree):** Sorts all the moving space junk into specific 3D space sectors for quick searching.
3. **Threat Radar (Min-Heap):** Looks at the junk in the satellite's sector and puts the closest, most dangerous piece at the very top of the priority list.
4. **Flight Computer (OOP Polymorphism):** Checks the Threat Radar. If junk crosses the safe distance, it fires the thrusters to move the satellite and uses up fuel.
5. **Health Monitor (Circular Queue):** Constantly tracks battery history and software. It auto-fixes software bugs or turns the satellite off if a physical part breaks.
6. **Blackbox (Output):** Saves every movement, error, and dodge into a text file for review later.

##  Project Outcome / Deliverables
A working C++ program that runs in the computer terminal. 
* **Live Updates:** The screen will show a live update of all satellites, displaying their current health, and printing alert messages if they are dodging debris or fixing bugs. 
* **Log File:** When the simulation finishes, the program creates a `blackbox.txt` file—a complete history book of the mission listing every single event, crash alert, and repair, along with exact timestamps.

##  Assumptions
* Satellites can instantly fire their thrusters to change direction.
* Simple straight-line 3D math is used for movement instead of real-world curved gravity orbits.
* Satellites have perfect sensors and know exactly where the space junk is in their immediate AVL Tree sector.
* Physical repairs take a fixed amount of time to complete.

##  References
* C++ coding guides for building self-balancing AVL Trees and Min-Heaps.
* C++ standard documentation for Object-Oriented Programming principles (Inheritance and Polymorphism).
* Basic 3D math for calculating the distance between two moving points in space.
